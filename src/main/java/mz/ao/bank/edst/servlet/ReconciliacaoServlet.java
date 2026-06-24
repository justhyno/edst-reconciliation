package mz.ao.bank.edst.servlet;

import com.google.gson.Gson;
import mz.ao.bank.edst.model.*;
import mz.ao.bank.edst.parser.FicheiroAParser;
import mz.ao.bank.edst.parser.FicheiroBParser;
import mz.ao.bank.edst.reconciliation.Reconciliador;
import mz.ao.bank.edst.util.CsvUtil;

import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.*;
import java.util.*;

/**
 * POST /api/reconciliar
 *
 * Parâmetros multipart: ficheiroA, ficheiroB, encoding.
 *
 * Processa os ficheiros no servidor, escreve os CSVs em disco e devolve
 * um JSON compacto (máx. 500 linhas por tabela + token de download).
 * Isto evita transferir megabytes de dados para o browser.
 */
@WebServlet("/api/reconciliar")
@MultipartConfig(
    fileSizeThreshold = 10 * 1024 * 1024,
    maxFileSize       = 2_000_000_000L,
    maxRequestSize    = 4_000_000_000L
)
public class ReconciliacaoServlet extends HttpServlet {

    private static final Gson GSON    = new Gson();
    private static final int  PREVIEW = 500;

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("application/json;charset=UTF-8");

        try {
            Part   partA    = req.getPart("ficheiroA");
            Part   partB    = req.getPart("ficheiroB");
            String encoding = req.getParameter("encoding");
            if (encoding == null || encoding.isEmpty()) encoding = "utf-8";

            if (partA == null || partA.getSize() == 0 ||
                partB == null || partB.getSize() == 0) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"Ficheiros A e B são obrigatórios.\"}");
                return;
            }

            ParseResultA        resultA = FicheiroAParser.parse(partA.getInputStream(), encoding);
            ParseResultB        resultB = FicheiroBParser.parse(partB.getInputStream(), encoding);
            ReconciliacaoResult rec     = Reconciliador.reconciliar(resultA.registos, resultB.registos);

            /* Write full CSVs to temp dir — browser downloads them via /api/download */
            String token  = UUID.randomUUID().toString();
            File   tmpDir = tempDir();
            writeCsvB(new File(tmpDir, "edst_" + token + "_B.csv"),       resultB.registos);
            writeCsvA(new File(tmpDir, "edst_" + token + "_A.csv"),       resultA.registos);
            writeCsvMatches(new File(tmpDir, "edst_" + token + "_matches.csv"), rec.matches);
            writeCsvA(new File(tmpDir, "edst_" + token + "_soA.csv"),     rec.soEmA);
            writeCsvB(new File(tmpDir, "edst_" + token + "_soB.csv"),     rec.soEmB);

            /* Compact JSON: preview rows only */
            Map<String, Object> debug = new LinkedHashMap<>();
            debug.put("totalLinhasA",      resultA.totalLinhas);
            debug.put("passaramFiltro",    resultA.passaramFiltro);
            debug.put("descartadasCurtas", resultA.descartadasCurtas);
            debug.put("totalBrutosB",      resultB.totalBrutos);
            debug.put("totalAclkB",        resultB.totalAclk);
            debug.put("nMatches",          rec.matches.size());
            debug.put("nSoA",              rec.soEmA.size());
            debug.put("nSoB",              rec.soEmB.size());

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("token",    token);
            body.put("registosB", preview(resultB.registos));
            body.put("registosA", preview(resultA.registos));
            body.put("matches",   preview(rec.matches));
            body.put("soEmA",     preview(rec.soEmA));
            body.put("soEmB",     preview(rec.soEmB));
            body.put("debug",     debug);

            resp.getWriter().write(GSON.toJson(body));

        } catch (Exception e) {
            resp.setStatus(500);
            resp.getWriter().write("{\"error\":" + GSON.toJson(e.getMessage()) + "}");
            getServletContext().log("ReconciliacaoServlet error", e);
        }
    }

    /* ── CSV writers ─────────────────────────────────────────── */

    private void writeCsvA(File file, List<RegistoA> list) throws IOException {
        try (PrintWriter pw = CsvUtil.openWriter(file)) {
            pw.println(CsvUtil.row("numLinha", "RRN", "linhaCompleta"));
            for (RegistoA r : list)
                pw.println(CsvUtil.row(String.valueOf(r.numLinha), r.RRN, r.linhaCompleta));
        }
    }

    private void writeCsvB(File file, List<RegistoB> list) throws IOException {
        try (PrintWriter pw = CsvUtil.openWriter(file)) {
            pw.println(CsvUtil.row("RRN","CARD","DHMSG","id",
                                   "campo_2","campo_3","campo_4","campo_6","campo_8","campo_9"));
            for (RegistoB r : list)
                pw.println(CsvUtil.row(r.RRN, r.CARD, r.DHMSG, r.id,
                                       r.campo_2, r.campo_3, r.campo_4,
                                       r.campo_6, r.campo_8, r.campo_9));
        }
    }

    private void writeCsvMatches(File file, List<MatchRec> list) throws IOException {
        try (PrintWriter pw = CsvUtil.openWriter(file)) {
            pw.println(CsvUtil.row("RRN","CARD","DHMSG","campo_6","campo_9","numLinhaA","OFS"));
            for (MatchRec m : list)
                pw.println(CsvUtil.row(m.RRN, m.CARD, m.DHMSG, m.campo_6,
                                       m.campo_9, String.valueOf(m.numLinhaA), m.OFS));
        }
    }

    /* ── Helpers ─────────────────────────────────────────────── */

    private <T> List<T> preview(List<T> list) {
        return list.size() <= PREVIEW ? list : list.subList(0, PREVIEW);
    }

    private File tempDir() {
        File d = (File) getServletContext().getAttribute("javax.servlet.context.tempdir");
        return d != null ? d : new File(System.getProperty("java.io.tmpdir"));
    }
}

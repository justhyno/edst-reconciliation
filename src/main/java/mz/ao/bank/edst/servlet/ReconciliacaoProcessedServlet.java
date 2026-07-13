package mz.ao.bank.edst.servlet;

import com.google.gson.Gson;
import mz.ao.bank.edst.model.*;
import mz.ao.bank.edst.parser.FicheiroProcessedParser;
import mz.ao.bank.edst.reconciliation.ReconciliadorProcessed;
import mz.ao.bank.edst.util.CsvUtil;

import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.*;
import java.util.*;

/**
 * POST /api/reconciliar-processed
 *
 * Parâmetros multipart: ficheiroC, ficheiroD, encoding.
 *
 * Processa no servidor, escreve CSVs em disco e devolve JSON compacto
 * (máx. 500 linhas por tabela + token de download).
 */
@WebServlet("/api/reconciliar-processed")
@MultipartConfig(
    fileSizeThreshold = 10 * 1024 * 1024,
    maxFileSize       = 2_000_000_000L,
    maxRequestSize    = 4_000_000_000L
)
public class ReconciliacaoProcessedServlet extends HttpServlet {

    private static final Gson GSON    = new Gson();
    private static final int  PREVIEW = 500;

    @Override
    protected void doPost(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        resp.setContentType("application/json;charset=UTF-8");

        try {
            Part   partC    = req.getPart("ficheiroC");
            Part   partD    = req.getPart("ficheiroD");
            String encoding = req.getParameter("encoding");
            if (encoding == null || encoding.isEmpty()) encoding = "utf-8";

            if (partC == null || partC.getSize() == 0 ||
                partD == null || partD.getSize() == 0) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"Ficheiros C e D são obrigatórios.\"}");
                return;
            }

            /* Validate PROCESSED.EDST prefix */
            String nameC = getFileName(partC);
            String nameD = getFileName(partD);
            if (!nameC.toUpperCase().startsWith("PROCESSED.EDST")) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"Ficheiro C deve ter o prefixo PROCESSED.EDST (recebido: " + nameC + ").\"}");
                return;
            }
            if (!nameD.toUpperCase().startsWith("PROCESSED.EDST")) {
                resp.setStatus(400);
                resp.getWriter().write("{\"error\":\"Ficheiro D deve ter o prefixo PROCESSED.EDST (recebido: " + nameD + ").\"}");
                return;
            }

            ParseResultProcessed       resultC = FicheiroProcessedParser.parse(partC.getInputStream(), encoding);
            ParseResultProcessed       resultD = FicheiroProcessedParser.parse(partD.getInputStream(), encoding);
            ReconciliacaoProcessedResult rec   = ReconciliadorProcessed.reconciliar(resultC.registos, resultD.registos);
            List<Transaccao> transaccoes       = ReconciliadorProcessed.extrairTransaccoes(rec.matches);

            /* Write full CSVs to temp dir */
            String token  = UUID.randomUUID().toString();
            File   tmpDir = tempDir();
            writeCsvSimples(new File(tmpDir, "edst_" + token + "_C.csv"),        resultC.registos);
            writeCsvSimples(new File(tmpDir, "edst_" + token + "_D.csv"),        resultD.registos);
            writeCsvMatches(new File(tmpDir, "edst_" + token + "_matchesP.csv"), rec.matches);
            writeCsvSimples(new File(tmpDir, "edst_" + token + "_soC.csv"),      rec.soEmC);
            writeCsvSimples(new File(tmpDir, "edst_" + token + "_soD.csv"),      rec.soEmD);
            writeCsvTransaccoes(new File(tmpDir, "edst_" + token + "_transaccoes.csv"), transaccoes);
            writeCsvSimples(new File(tmpDir, "edst_" + token + "_failedC.csv"),  resultC.falhas);
            writeCsvSimples(new File(tmpDir, "edst_" + token + "_failedD.csv"),  resultD.falhas);

            /* Compact JSON */
            Map<String, Object> debug = new LinkedHashMap<>();
            debug.put("totalRequestC", resultC.totalRequest);
            debug.put("exclC",         resultC.excluidos);
            debug.put("failedC",       resultC.falhas.size());
            debug.put("totalRequestD", resultD.totalRequest);
            debug.put("exclD",         resultD.excluidos);
            debug.put("failedD",       resultD.falhas.size());
            debug.put("nMatches",      rec.matches.size());
            debug.put("nSoC",          rec.soEmC.size());
            debug.put("nSoD",          rec.soEmD.size());
            debug.put("nTransaccoes",  transaccoes.size());

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("token",       token);
            body.put("registosC",   preview(resultC.registos));
            body.put("registosD",   preview(resultD.registos));
            body.put("matches",     preview(rec.matches));
            body.put("soEmC",       preview(rec.soEmC));
            body.put("soEmD",       preview(rec.soEmD));
            body.put("transaccoes", preview(transaccoes));
            body.put("falhasC",     preview(resultC.falhas));
            body.put("falhasD",     preview(resultD.falhas));
            body.put("debug",       debug);

            resp.getWriter().write(GSON.toJson(body));

        } catch (Exception e) {
            resp.setStatus(500);
            resp.getWriter().write("{\"error\":" + GSON.toJson(e.getMessage()) + "}");
            getServletContext().log("ReconciliacaoProcessedServlet error", e);
        }
    }

    /* ── CSV writers ─────────────────────────────────────────── */

    private void writeCsvSimples(File file, List<RegistoProcessed> list) throws IOException {
        try (PrintWriter pw = CsvUtil.openWriter(file)) {
            pw.println(CsvUtil.row("ID", "Resposta"));
            for (RegistoProcessed r : list)
                pw.println(CsvUtil.row(r.id, r.resposta));
        }
    }

    private void writeCsvMatches(File file, List<MatchProcessed> list) throws IOException {
        try (PrintWriter pw = CsvUtil.openWriter(file)) {
            pw.println(CsvUtil.row("ID", "Resposta_C", "Resposta_D"));
            for (MatchProcessed m : list)
                pw.println(CsvUtil.row(m.id, m.respostaC, m.respostaD));
        }
    }

    private void writeCsvTransaccoes(File file, List<Transaccao> list) throws IOException {
        try (PrintWriter pw = CsvUtil.openWriter(file)) {
            pw.println(CsvUtil.row("ID","Referencia","Balcao","Resposta_C","Resposta_D"));
            for (Transaccao t : list)
                pw.println(CsvUtil.row(t.id, t.referencia, t.balcao, t.respostaC, t.respostaD));
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

    private String getFileName(Part part) {
        String cd = part.getHeader("content-disposition");
        if (cd != null) {
            for (String token : cd.split(";")) {
                String t = token.trim();
                if (t.startsWith("filename")) {
                    String name = t.substring(t.indexOf('=') + 1).trim().replace("\"", "");
                    int slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
                    return slash >= 0 ? name.substring(slash + 1) : name;
                }
            }
        }
        return "";
    }
}

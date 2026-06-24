package mz.ao.bank.edst.servlet;

import com.google.gson.Gson;
import mz.ao.bank.edst.model.*;
import mz.ao.bank.edst.parser.FicheiroAParser;
import mz.ao.bank.edst.parser.FicheiroBParser;
import mz.ao.bank.edst.reconciliation.Reconciliador;

import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.Part;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * POST /api/reconciliar
 *
 * Parâmetros multipart:
 *   ficheiroA  — Ficheiro A (EDST, fixed-width)
 *   ficheiroB  — Ficheiro B (ATM MESSAGE LOG, key-value multi-linha)
 *   encoding   — "utf-8" | "windows-1252"
 *
 * Resposta: JSON com registosA, registosB, matches, soEmA, soEmB, debug.
 */
@WebServlet("/api/reconciliar")
@MultipartConfig(
    fileSizeThreshold = 10 * 1024 * 1024,    // 10 MB — acima disto vai para disco
    maxFileSize       = 2_000_000_000L,       // 2 GB por ficheiro
    maxRequestSize    = 4_000_000_000L        // 4 GB total
)
public class ReconciliacaoServlet extends HttpServlet {

    private static final Gson GSON = new Gson();

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

            ParseResultA       resultA = FicheiroAParser.parse(partA.getInputStream(), encoding);
            ParseResultB       resultB = FicheiroBParser.parse(partB.getInputStream(), encoding);
            ReconciliacaoResult rec    = Reconciliador.reconciliar(resultA.registos, resultB.registos);

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
            body.put("registosB", resultB.registos);
            body.put("registosA", resultA.registos);
            body.put("matches",   rec.matches);
            body.put("soEmA",     rec.soEmA);
            body.put("soEmB",     rec.soEmB);
            body.put("debug",     debug);

            resp.getWriter().write(GSON.toJson(body));

        } catch (Exception e) {
            resp.setStatus(500);
            resp.getWriter().write("{\"error\":" + GSON.toJson(e.getMessage()) + "}");
            getServletContext().log("ReconciliacaoServlet error", e);
        }
    }
}

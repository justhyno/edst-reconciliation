package mz.ao.bank.edst.servlet;

import com.google.gson.Gson;
import mz.ao.bank.edst.model.*;
import mz.ao.bank.edst.parser.FicheiroProcessedParser;
import mz.ao.bank.edst.reconciliation.ReconciliadorProcessed;

import javax.servlet.ServletException;
import javax.servlet.annotation.MultipartConfig;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.Part;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * POST /api/reconciliar-processed
 *
 * Parâmetros multipart:
 *   ficheiroC  — Ficheiro C (processed.EDST — pedidos/respostas)
 *   ficheiroD  — Ficheiro D (processed.EDST — pedidos/respostas)
 *   encoding   — "utf-8" | "windows-1252"
 *
 * Resposta: JSON com registosC, registosD, matches, soEmC, soEmD,
 *           transaccoes, debug.
 */
@WebServlet("/api/reconciliar-processed")
@MultipartConfig(
    fileSizeThreshold = 10 * 1024 * 1024,
    maxFileSize       = 2_000_000_000L,
    maxRequestSize    = 4_000_000_000L
)
public class ReconciliacaoProcessedServlet extends HttpServlet {

    private static final Gson GSON = new Gson();

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

            ParseResultProcessed       resultC = FicheiroProcessedParser.parse(partC.getInputStream(), encoding);
            ParseResultProcessed       resultD = FicheiroProcessedParser.parse(partD.getInputStream(), encoding);
            ReconciliacaoProcessedResult rec   =
                ReconciliadorProcessed.reconciliar(resultC.registos, resultD.registos);
            List<Transaccao> transaccoes = ReconciliadorProcessed.extrairTransaccoes(rec.matches);

            Map<String, Object> debug = new LinkedHashMap<>();
            debug.put("totalRequestC", resultC.totalRequest);
            debug.put("exclC",         resultC.excluidos);
            debug.put("totalRequestD", resultD.totalRequest);
            debug.put("exclD",         resultD.excluidos);
            debug.put("nMatches",      rec.matches.size());
            debug.put("nSoC",          rec.soEmC.size());
            debug.put("nSoD",          rec.soEmD.size());
            debug.put("nTransaccoes",  transaccoes.size());

            Map<String, Object> body = new LinkedHashMap<>();
            body.put("registosC",   resultC.registos);
            body.put("registosD",   resultD.registos);
            body.put("matches",     rec.matches);
            body.put("soEmC",       rec.soEmC);
            body.put("soEmD",       rec.soEmD);
            body.put("transaccoes", transaccoes);
            body.put("debug",       debug);

            resp.getWriter().write(GSON.toJson(body));

        } catch (Exception e) {
            resp.setStatus(500);
            resp.getWriter().write("{\"error\":" + GSON.toJson(e.getMessage()) + "}");
            getServletContext().log("ReconciliacaoProcessedServlet error", e);
        }
    }
}

package mz.ao.bank.edst.servlet;

import javax.servlet.annotation.WebServlet;
import javax.servlet.http.*;
import java.io.*;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * GET /api/download?token=UUID&type=TYPE
 *
 * Serve o CSV pré-gerado pelo servlet de processamento.
 * O token (UUID) garante que só ficheiros gerados por esta aplicação
 * são servidos — nenhum path traversal é possível.
 */
@WebServlet("/api/download")
public class DownloadServlet extends HttpServlet {

    private static final Pattern UUID_PAT = Pattern.compile(
        "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
    private static final Pattern TYPE_PAT = Pattern.compile("[A-Za-z]+");

    private static final Map<String, String> FILENAMES = new HashMap<>();
    static {
        FILENAMES.put("A",           "ficheiroA_filtrado.csv");
        FILENAMES.put("B",           "ficheiroB_parseado.csv");
        FILENAMES.put("matches",     "reconciliacao_matches.csv");
        FILENAMES.put("soA",         "reconciliacao_so_em_A.csv");
        FILENAMES.put("soB",         "reconciliacao_so_em_B.csv");
        FILENAMES.put("C",           "processedEDST_ficheiroC.csv");
        FILENAMES.put("D",           "processedEDST_ficheiroD.csv");
        FILENAMES.put("matchesP",    "processedEDST_matches.csv");
        FILENAMES.put("soC",         "processedEDST_so_em_C.csv");
        FILENAMES.put("soD",         "processedEDST_so_em_D.csv");
        FILENAMES.put("transaccoes", "processedEDST_transaccoes.csv");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
        String token = req.getParameter("token");
        String type  = req.getParameter("type");

        if (token == null || !UUID_PAT.matcher(token).matches() ||
            type  == null || !TYPE_PAT.matcher(type).matches()  ||
            !FILENAMES.containsKey(type)) {
            resp.sendError(400, "Parâmetros inválidos.");
            return;
        }

        File tmpDir = (File) getServletContext().getAttribute("javax.servlet.context.tempdir");
        if (tmpDir == null) tmpDir = new File(System.getProperty("java.io.tmpdir"));

        File csv = new File(tmpDir, "edst_" + token + "_" + type + ".csv");

        /* Security: ensure the resolved path is still inside tmpDir */
        if (!csv.exists() || !csv.getCanonicalPath().startsWith(tmpDir.getCanonicalPath())) {
            resp.sendError(404, "Ficheiro não encontrado ou expirado.");
            return;
        }

        String filename = FILENAMES.get(type);
        resp.setContentType("text/csv;charset=UTF-8");
        resp.setHeader("Content-Disposition",
            "attachment; filename=\"" + filename + "\"");
        resp.setHeader("Content-Length", String.valueOf(csv.length()));

        byte[] buf = new byte[64 * 1024];
        try (InputStream in = new FileInputStream(csv)) {
            int n;
            while ((n = in.read(buf)) != -1)
                resp.getOutputStream().write(buf, 0, n);
        }
    }
}

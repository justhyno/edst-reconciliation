package mz.ao.bank.edst.parser;

import mz.ao.bank.edst.model.ParseResultB;
import mz.ao.bank.edst.model.RegistoB;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/**
 * Parseia o Ficheiro B (ATM MESSAGE LOG).
 *
 * Formato multi-linha: cada registo começa com "id: <ID>" e as linhas
 * seguintes contêm os campos numéricos "N: <valor>|".
 *
 * O ID é dividido em RRN.CARD.DHMSG por '.'.
 * São mantidos apenas registos cujo campo_6 começa por "ACLK".
 */
public class FicheiroBParser {

    public static ParseResultB parse(InputStream in, String encoding) throws IOException {
        List<RegistoB> todos     = new ArrayList<>();
        RegistoB       regActual = null;

        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, encoding))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String lt = linha.trim();
                if (lt.isEmpty()) continue;

                String ltLower = lt.toLowerCase();

                if (ltLower.startsWith("id:")) {
                    if (regActual != null) todos.add(regActual);
                    String idCompleto = extractValue(lt);
                    String[] partes   = idCompleto.split("\\.", -1);
                    regActual         = new RegistoB();
                    regActual.id      = idCompleto;
                    regActual.RRN     = partes.length > 0 ? partes[0] : "";
                    regActual.CARD    = partes.length > 1 ? partes[1] : "";
                    regActual.DHMSG   = partes.length > 2 ? partes[2] : "";
                } else if (regActual != null) {
                    int colon = lt.indexOf(':');
                    if (colon > 0) {
                        String numStr = lt.substring(0, colon).trim();
                        try {
                            int n = Integer.parseInt(numStr);
                            if (n >= 1 && n <= 9) {
                                String val = lt.substring(colon + 1).trim();
                                if (val.endsWith("|")) val = val.substring(0, val.length() - 1).trim();
                                setField(regActual, n, val);
                            }
                        } catch (NumberFormatException ignored) { /* not a field line */ }
                    }
                }
            }
        }

        if (regActual != null) todos.add(regActual);

        List<RegistoB> filtrados = new ArrayList<>();
        for (RegistoB r : todos) {
            if (r.campo_6.startsWith("ACLK")) filtrados.add(r);
        }

        ParseResultB result = new ParseResultB();
        result.registos    = filtrados;
        result.totalBrutos = todos.size();
        result.totalAclk   = filtrados.size();
        return result;
    }

    private static String extractValue(String linha) {
        int idx = linha.indexOf(':');
        if (idx == -1) return "";
        String val = linha.substring(idx + 1).trim();
        if (val.endsWith("|")) val = val.substring(0, val.length() - 1).trim();
        return val;
    }

    private static void setField(RegistoB r, int n, String val) {
        switch (n) {
            case 1: r.campo_1 = val; break;
            case 2: r.campo_2 = val; break;
            case 3: r.campo_3 = val; break;
            case 4: r.campo_4 = val; break;
            case 5: r.campo_5 = val; break;
            case 6: r.campo_6 = val; break;
            case 7: r.campo_7 = val; break;
            case 8: r.campo_8 = val; break;
            case 9: r.campo_9 = val; break;
        }
    }
}

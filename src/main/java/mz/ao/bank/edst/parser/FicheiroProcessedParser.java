package mz.ao.bank.edst.parser;

import mz.ao.bank.edst.model.ParseResultProcessed;
import mz.ao.bank.edst.model.RegistoProcessed;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/**
 * Parseia um ficheiro processed.EDST.
 *
 * Linhas com prefixo "request" iniciam uma transacção.
 * ID: 12 chars a partir do índice 11 (0-based): substring(11, 23).
 *
 * Linhas com prefixo "response" pertencem à transacção actual.
 *
 * São mantidas apenas transacções com exactamente 1 resposta.
 */
public class FicheiroProcessedParser {

    public static ParseResultProcessed parse(InputStream in, String encoding) throws IOException {
        List<RegistoProcessed> todos        = new ArrayList<>();
        String                 idActual     = null;
        List<String>           respostasAct = new ArrayList<>();
        int totalRequest  = 0;
        int totalResponse = 0;

        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, encoding))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                String lt      = linha.trim();
                if (lt.isEmpty()) continue;
                String ltLower = lt.toLowerCase();

                if (ltLower.startsWith("request")) {
                    if (idActual != null) {
                        flushRegisto(todos, idActual, respostasAct);
                    }
                    totalRequest++;
                    int fim = Math.min(23, lt.length());
                    idActual = lt.length() >= 12 ? lt.substring(Math.min(11, lt.length()), fim).trim() : "";
                    respostasAct = new ArrayList<>();

                } else if (ltLower.startsWith("response") && idActual != null) {
                    totalResponse++;
                    respostasAct.add(lt);
                }
            }
        }

        if (idActual != null) flushRegisto(todos, idActual, respostasAct);

        /* Keep only transactions with exactly 1 response */
        List<RegistoProcessed> registos  = new ArrayList<>();
        int excluidos = 0;
        for (RegistoProcessed r : todos) {
            if (r.resposta != null) {
                registos.add(r);
            } else {
                excluidos++;
            }
        }

        ParseResultProcessed result = new ParseResultProcessed();
        result.registos      = registos;
        result.totalRequest  = totalRequest;
        result.totalResponse = totalResponse;
        result.excluidos     = excluidos;
        return result;
    }

    private static void flushRegisto(List<RegistoProcessed> dest,
                                     String id, List<String> respostas) {
        if (respostas.size() != 1) {
            /* multi-response or no-response: mark as null so caller can count */
            RegistoProcessed r = new RegistoProcessed();
            r.id      = id;
            r.resposta = null;
            dest.add(r);
        } else {
            RegistoProcessed r = new RegistoProcessed();
            r.id       = id;
            r.resposta = respostas.get(0);
            dest.add(r);
        }
    }
}

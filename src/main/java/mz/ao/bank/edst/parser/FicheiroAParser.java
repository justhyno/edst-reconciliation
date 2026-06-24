package mz.ao.bank.edst.parser;

import mz.ao.bank.edst.model.ParseResultA;
import mz.ao.bank.edst.model.RegistoA;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.util.ArrayList;
import java.util.List;

/**
 * Parseia o Ficheiro A (EDST, largura fixa).
 *
 * Critério de filtro (posições 1-indexed):
 *   pos 1 == '1'  e  pos 7 == '6'
 *   comprimento mínimo: 352
 *
 * RRN: substring(339, 351) — posições 340-352 (1-indexed), 12 chars.
 */
public class FicheiroAParser {

    public static ParseResultA parse(InputStream in, String encoding) throws IOException {
        List<RegistoA> registos       = new ArrayList<>();
        int totalLinhas       = 0;
        int passaramFiltro    = 0;
        int descartadasCurtas = 0;
        int numLinha          = 0;

        try (BufferedReader br = new BufferedReader(new InputStreamReader(in, encoding))) {
            String linha;
            while ((linha = br.readLine()) != null) {
                numLinha++;
                if (linha.isEmpty()) continue;
                totalLinhas++;

                if (linha.charAt(0) != '1') continue;
                if (linha.length() < 7 || linha.charAt(6) != '6') continue;

                if (linha.length() < 352) {
                    descartadasCurtas++;
                    continue;
                }

                passaramFiltro++;
                RegistoA r = new RegistoA();
                r.numLinha      = numLinha;
                r.RRN           = linha.substring(339, 351).trim();
                r.linhaCompleta = linha;
                registos.add(r);
            }
        }

        ParseResultA result = new ParseResultA();
        result.registos          = registos;
        result.totalLinhas       = totalLinhas;
        result.passaramFiltro    = passaramFiltro;
        result.descartadasCurtas = descartadasCurtas;
        return result;
    }
}

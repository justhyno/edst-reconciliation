package mz.ao.bank.edst.reconciliation;

import mz.ao.bank.edst.model.*;

import java.util.*;

public class ReconciliadorProcessed {

    public static ReconciliacaoProcessedResult reconciliar(
            List<RegistoProcessed> regsC, List<RegistoProcessed> regsD) {

        Map<String, RegistoProcessed> mapaC = new LinkedHashMap<>();
        for (RegistoProcessed r : regsC) mapaC.put(r.id, r);

        Map<String, RegistoProcessed> mapaD = new HashMap<>();
        for (RegistoProcessed r : regsD) mapaD.put(r.id, r);

        List<MatchProcessed>   matches = new ArrayList<>();
        List<RegistoProcessed> soEmC   = new ArrayList<>();
        List<RegistoProcessed> soEmD   = new ArrayList<>();

        for (Map.Entry<String, RegistoProcessed> e : mapaC.entrySet()) {
            String id = e.getKey();
            if (mapaD.containsKey(id)) {
                MatchProcessed m = new MatchProcessed();
                m.id        = id;
                m.respostaC = e.getValue().resposta;
                m.respostaD = mapaD.get(id).resposta;
                matches.add(m);
            } else {
                soEmC.add(e.getValue());
            }
        }

        for (Map.Entry<String, RegistoProcessed> e : mapaD.entrySet()) {
            if (!mapaC.containsKey(e.getKey())) soEmD.add(e.getValue());
        }

        ReconciliacaoProcessedResult result = new ReconciliacaoProcessedResult();
        result.matches = matches;
        result.soEmC   = soEmC;
        result.soEmD   = soEmD;
        return result;
    }

    public static List<Transaccao> extrairTransaccoes(List<MatchProcessed> matches) {
        final String MARKER_REF = "//1";
        final String MARKER_BAL = "CO.CODE:1:1=";
        List<Transaccao> resultado = new ArrayList<>();

        for (MatchProcessed m : matches) {
            String respC = m.respostaC != null ? m.respostaC : "";
            String respD = m.respostaD != null ? m.respostaD : "";

            if (!respD.toLowerCase().contains("duplicate")) continue;
            if (!respC.contains(MARKER_REF))               continue;

            int    idxRef    = respC.indexOf(MARKER_REF);
            int    inicio    = Math.max(0, idxRef - 14);
            String referencia = respC.substring(inicio, idxRef).trim();

            String balcao = "";
            int    idxBal = respC.indexOf(MARKER_BAL);
            if (idxBal != -1) {
                int s = idxBal + MARKER_BAL.length();
                int e = Math.min(s + 9, respC.length());
                balcao = respC.substring(s, e).trim();
            }

            Transaccao t = new Transaccao();
            t.id        = m.id;
            t.referencia = referencia;
            t.balcao    = balcao;
            t.respostaC = respC;
            t.respostaD = respD;
            resultado.add(t);
        }

        return resultado;
    }
}

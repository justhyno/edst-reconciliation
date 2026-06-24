package mz.ao.bank.edst.reconciliation;

import mz.ao.bank.edst.model.*;

import java.util.*;

public class Reconciliador {

    public static ReconciliacaoResult reconciliar(List<RegistoA> regsA, List<RegistoB> regsB) {
        Map<String, List<RegistoA>> mapaA = groupByRRN(regsA);
        Map<String, List<RegistoB>> mapaB = new LinkedHashMap<>();
        for (RegistoB r : regsB) {
            mapaB.computeIfAbsent(r.RRN, k -> new ArrayList<>()).add(r);
        }

        List<MatchRec> matches = new ArrayList<>();
        List<RegistoA> soEmA   = new ArrayList<>();
        List<RegistoB> soEmB   = new ArrayList<>();

        for (Map.Entry<String, List<RegistoA>> e : mapaA.entrySet()) {
            String          rrn    = e.getKey();
            List<RegistoA>  listaA = e.getValue();
            if (mapaB.containsKey(rrn)) {
                for (RegistoA rA : listaA) {
                    for (RegistoB rB : mapaB.get(rrn)) {
                        MatchRec m  = new MatchRec();
                        m.RRN       = rrn;
                        m.CARD      = rB.CARD;
                        m.DHMSG     = rB.DHMSG;
                        m.campo_6   = rB.campo_6;
                        m.campo_9   = rB.campo_9;
                        m.numLinhaA = rA.numLinha;
                        m.OFS       = "AC.LOCKED.EVENTS,VISA/R/PROCESS/1/0/,NBOL.USER/123456/"
                                    + rB.campo_9 + "/////," + rB.campo_6;
                        matches.add(m);
                    }
                }
            } else {
                soEmA.addAll(listaA);
            }
        }

        for (Map.Entry<String, List<RegistoB>> e : mapaB.entrySet()) {
            if (!mapaA.containsKey(e.getKey())) soEmB.addAll(e.getValue());
        }

        ReconciliacaoResult result = new ReconciliacaoResult();
        result.matches = matches;
        result.soEmA   = soEmA;
        result.soEmB   = soEmB;
        return result;
    }

    private static Map<String, List<RegistoA>> groupByRRN(List<RegistoA> registos) {
        Map<String, List<RegistoA>> mapa = new LinkedHashMap<>();
        for (RegistoA r : registos) {
            mapa.computeIfAbsent(r.RRN, k -> new ArrayList<>()).add(r);
        }
        return mapa;
    }
}

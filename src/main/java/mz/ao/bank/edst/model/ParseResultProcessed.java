package mz.ao.bank.edst.model;

import java.util.List;

public class ParseResultProcessed {
    public List<RegistoProcessed> registos;
    public List<RegistoProcessed> falhas;
    public int totalRequest;
    public int totalResponse;
    public int excluidos;
}

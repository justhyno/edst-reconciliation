package mz.ao.bank.edst.util;

import java.io.*;
import java.nio.charset.StandardCharsets;

public final class CsvUtil {

    private CsvUtil() {}

    /** Opens a PrintWriter with UTF-8 BOM so Excel recognises the encoding. */
    public static PrintWriter openWriter(File file) throws IOException {
        FileOutputStream fos = new FileOutputStream(file);
        fos.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});
        return new PrintWriter(new BufferedWriter(
                new OutputStreamWriter(fos, StandardCharsets.UTF_8)));
    }

    /** Formats one CSV row with ";" separator and RFC-4180 quoting. */
    public static String row(String... fields) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < fields.length; i++) {
            if (i > 0) sb.append(';');
            String f = fields[i] != null ? fields[i] : "";
            if (f.contains(";") || f.contains("\"") || f.contains("\n")) {
                sb.append('"').append(f.replace("\"", "\"\"")).append('"');
            } else {
                sb.append(f);
            }
        }
        return sb.toString();
    }
}

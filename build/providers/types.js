const OCC_SYMBOL_RE = /^[A-Z.]{1,6}\d{6}[CP]\d{8}$/;
export function isOccOptionSymbol(symbol) {
    return OCC_SYMBOL_RE.test(symbol);
}

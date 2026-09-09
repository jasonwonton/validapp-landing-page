export function activate({ isCurrent, load }) {
    if (isCurrent()) return load();
}

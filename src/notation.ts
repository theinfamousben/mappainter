export function StandardNotation(num: number): string {
    const suffixes: string[] = ["", "K", "M", "B", "T", "Qd", "Qt", "Sx", "Sp", "Oc", "No"];
    const exp = Math.floor(Math.log10(Math.abs(num)));

    if (exp > suffixes.length * 3) {
        return SciNotation(num);
    }

    if (num < 1000) {
        return num.toFixed(2);
    }

    const suffixIndex = Math.floor(exp / 3);
    const mantissa = num / Math.pow(10, exp);

    return mantissa.toFixed(2) + suffixes[suffixIndex];
}

export function SciNotation (num: number): string {
    const exp = Math.floor(Math.log10(Math.abs(num)));
    const mantissa = num / Math.pow(10, exp);
    return mantissa.toFixed(2) + "e" + exp;
}

export function timeNotation(ms: number): string {
    const days = Math.floor(ms / 86400000);
    ms %= 86400000;
    const hours = Math.floor(ms / 3600000);
    ms %= 3600000;
    const minutes = Math.floor(ms / 60000);
    ms %= 60000;
    const seconds = Math.floor(ms / 1000);
    ms %= 1000;

    const parts: string[] = [];

    if (days > 0) parts.push(days < 10 ? `0${days}` : days.toString());
    if ((hours > 0 || parts.length > 0) && ms < 60000) parts.push(hours < 10 ? `0${hours}` : hours.toString());
    if ((minutes > 0 || parts.length > 0) && ms < 60000) parts.push(minutes < 10 ? `0${minutes}` : minutes.toString());
    if ((seconds > 0 || parts.length > 0) && ms < 60000) parts.push(seconds < 10 ? `0${seconds}` : seconds.toString());

    const msstr = ms < 100 ?
        ms < 10 ?
            `00${ms}` :
            `0${ms}` :
        ms.toString();
    
    if (ms < 60000) parts.push(msstr);
    return parts.join(":");

}
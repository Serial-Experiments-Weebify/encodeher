export interface Resolution {
    name: string;
    w: number;
    h: number;
}

const NAMED_RESOLUTIONS: Resolution[] = [
    { name: "4k", w: 3840, h: 2160 },
    { name: "1440p", w: 2560, h: 1440 },
    { name: "1080p", w: 1920, h: 1080 },
    { name: "720p", w: 1280, h: 720 },
];

const SIXTEEN_BY_NINE = 16 / 9;

function roundByTwo(x: number) {
    return Math.round(x) & ~1;
}

export function getResolutions(inW: number, inH: number) {
    const resolutions: Resolution[] = [{ name: "native", w: inW, h: inH }];
    const ar = inW / inH;

    if (ar >= SIXTEEN_BY_NINE) {
        // calculate resolutions by width
        resolutions.push(
            ...NAMED_RESOLUTIONS.filter((x) => x.w < inW).map(
                ({ w, name }) => ({
                    name,
                    w,
                    h: roundByTwo((w / inW) * inH) & ~1,
                })
            )
        );
    } else {
        // calculate resolutions by height
        resolutions.push(
            ...NAMED_RESOLUTIONS.filter((x) => x.h < inH).map(
                ({ h, name }) => ({
                    name,
                    w: roundByTwo((h / inH) * inW) & ~1,
                    h,
                })
            )
        );
    }

    return resolutions;
}

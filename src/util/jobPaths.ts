import path from 'path';
import os from 'os';

export function getTmpPath() {
    return path.join(os.tmpdir(), 'weebify-encodeher');
}

export function getJobPaths(
    job: string,
    baseDir: string | undefined = undefined,
) {
    const basedir = path.join(baseDir ?? getTmpPath(), job);
    const fontdir = path.join(basedir, 'fonts');
    const outdir = path.join(basedir, 'out');

    return { basedir, fontdir, outdir };
}

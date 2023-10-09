import { join } from 'path';
import { WeebifyInstance } from '../util/weebifyInstance';
import { MultiBar } from 'cli-progress';
import { PROGRESS_CONF } from '../util/progress';
import { getJobPaths } from '../util/jobPaths';
import { readFile } from 'fs/promises';
import { WeebifyV1Manifest } from '../util/weebifyManifest';

function stringConstantLength(str: string, len: number) {
    if (str.length > len) return '...' + str.slice(3 + -len);
    return str.padStart(len, ' ');
}

export async function pushV1(
    job: string,
    instance: string,
    token: string,
    dir: string | undefined = undefined,
) {
    try {
        const { basedir, outdir } = getJobPaths(job, dir);

        // try file
        const manifest = JSON.parse(
            (await readFile(join(outdir, 'weebify.json'))).toString(),
        ) as WeebifyV1Manifest;

        const i = new WeebifyInstance(instance, token);
        await i.checkAuth();

        console.log('Creating video...');
        const { video } = await i.createV1(manifest);

        console.log('Uploading video...');

        const bars = new MultiBar(...PROGRESS_CONF);

        await Promise.all(
            video.keys.map(async (key) => {
                const bar = bars.create(100, 0, {
                    job: stringConstantLength(key.src, 30),
                    status: 'Uploading',
                });

                await i.s3PresignedPut(
                    key.key,
                    join(basedir, key.src),
                    (p) => p.progress && bar.update(p.progress * 100),
                );

                bar.update(100, { status: 'Done' });
            }),
        );

        bars.stop();

        console.log('Verifying...');
        await i.verify(video.id);

        console.log(`Succesfully uploaded ${job} as video ${video.id}`);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

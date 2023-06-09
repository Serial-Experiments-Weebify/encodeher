import { access } from 'fs/promises';
import { basename } from 'path';
import { WeebifyInstance } from '../util/weebifyInstance';
import { Bar } from 'cli-progress';
import { PROGRESS_CONF } from '../util/progress';

const VALID_V0_EXTENSIONS = ['mp4', 'm4v'];
const JOBNAME_REGEX = /^[a-z0-9\-]{3,120}$/i;

function getJobname(file: string) {
    const filename = basename(file);

    const parts = filename.split('.');

    if (parts.length != 2)
        throw 'Filename must be in the format of <jobname>.<ext>';

    if (!JOBNAME_REGEX.test(parts[0])) {
        throw 'Jobname should be 3-120 characters and can only contain letters, digits and dashes/';
    }

    if (!VALID_V0_EXTENSIONS.includes(parts[1])) {
        throw `Extension must be one of: ${VALID_V0_EXTENSIONS.join(', ')}`;
    }

    return parts[0];
}

export async function pushV0(file: string, instance: string, token: string) {
    try {
        // try file
        await access(file);

        const job = getJobname(file);

        const i = new WeebifyInstance(instance, token);
        await i.checkAuth();

        console.log('Creating video...');
        const { video } = await i.createV0(job);

        console.log('Uploading video...');

        const bar = new Bar(...PROGRESS_CONF);
        bar.start(100, 0, { job });

        await i.s3PresignedPut(
            video.key,
            file,
            (p) => p.progress && bar.update(p.progress * 100),
        );

        bar.stop();

        console.log('Verifying...');
        await i.verify(video.id);

        console.log(`Succesfully uploaded ${job} as video ${video.id}`);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

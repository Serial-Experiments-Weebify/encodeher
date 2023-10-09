import { createWriteStream, type WriteStream } from 'fs';
import { join } from 'path';

export class EncodherLogger {
    protected out: WriteStream;
    protected tags: string[] = [];

    public constructor(outDir: string) {
        const logPath = join(outDir, 'encodeher.log');
        this.out = createWriteStream(logPath, { autoClose: true });
    }

    public append(text: string) {
        this.out.write(text);
    }

    public writeHeader(tag = 'REGION') {
        const padding = ' '.repeat(this.tags.length * 4);
        const str = `\n${padding}!BEGIN ${tag}!\n\n`;

        this.tags.push(tag);
        this.out.write(str);
    }

    public writeFooter() {
        const tag = this.tags.pop();

        const padding = ' '.repeat(this.tags.length * 4);
        const str = `\n${padding}!END ${tag}!\n\n`;

        this.out.write(str);
    }

    public close(reason = 'Finished') {
        this.out.cork();
        while (this.tags.length > 0) {
            this.writeFooter();
        }
        this.out.write(`!!! LOG END, REASON: ${reason} !!!\n`);

        this.out.close();
    }
}

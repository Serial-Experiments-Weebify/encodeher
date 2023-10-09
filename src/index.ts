import { program } from 'commander';
import { pack } from './commands/autopack';
import { pushV0 } from './commands/pushV0';
import { pushV1 } from './commands/pushV1';

program
    .name('encodeher')
    .description('The v1 Weebify encode(he)r')
    .option(
        '--basedir <directory>',
        'The directory where jobs get stored, defaults to a temporary directory',
    )
    .version('1.0.0-alpha');

program
    .command('autopack <source> <jobname>')
    .description('Autoencode a video file')
    .action((source, jobname, options) => {
        pack(source, jobname, options.basedir);
    });

program
    .command('push <jobname>')
    .option('--instance <url>', 'Weebify instance URL', 'https://weebify.tv/')
    .option('--token <token>', 'Upload token')
    .action((jobname, options) => {
        pushV1(jobname, options.instance, options.token, options.basedir);
    });

program
    .command('pushv0 <file>')
    .option('--instance <url>', 'Weebify instance URL', 'https://weebify.tv/')
    .option('--token <token>', 'Upload token')
    .action((file, options) => {
        pushV0(file, options.instance, options.token);
    });

program.parse();

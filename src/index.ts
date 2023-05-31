import { program } from "commander";
import { pack } from "./autopack";

program
    .name("encodeher")
    .description("The v1 Weebify encode(he)r")
    .option(
        "--basedir <directory>",
        "The directory where jobs get stored, defaults to a temporary directory"
    )
    .version("1.0.0-alpha");

program
    .command("encode <source> <jobname>")
    .description("Autoencode a video file")
    .action((source, jobname, options) => {
        pack(source, jobname, options.basedir);
    });

program
    .command("push <jobname>")
    .option("--instance <url>", "Weebify instance URL", "https://weebify.tv/")
    .option("--token <token>", "Upload token")
    .action((jobname, options) => {
        console.log({ jobname, options });
    });

program.parse();

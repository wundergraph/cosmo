import pc from 'picocolors';
export const createOutput = ({ json, stdout = process.stdout, stderr = process.stderr, }) => ({
    json,
    progress(event) {
        if (json) {
            stderr.write(`${JSON.stringify({ event: 'progress', ...event })}\n`);
            return;
        }
        const subject = event.subject ? `${pc.cyan(event.subject)} ` : '';
        stderr.write(`${pc.dim('›')} ${subject}${event.message}\n`);
    },
    result(data, render) {
        if (json) {
            stdout.write(`${JSON.stringify({ status: 'success', ...data })}\n`);
            return;
        }
        stdout.write(`${render(data)}\n`);
    },
    fail(failure) {
        process.exitCode = 1;
        if (json) {
            stdout.write(`${JSON.stringify({ status: 'error', error: failure })}\n`);
            return;
        }
        const lines = [pc.red(failure.message)];
        if (failure.input) {
            lines.push(`  input: ${failure.input}`);
        }
        if (failure.fix) {
            lines.push(`  fix: ${failure.fix}`);
        }
        stderr.write(`${lines.join('\n')}\n`);
    },
});
//# sourceMappingURL=output.js.map
/**
 * Clears whole screen
 */
export function clearScreen() {
  process.stdout.write('\u001Bc');
}

/**
 * Fancy WG logo
 */
export function printLogo() {
  console.log(`
        ▌            ▌
▌▌▌▌▌▛▌▛▌█▌▛▘▛▌▛▘▀▌▛▌▛▌
▚▚▘▙▌▌▌▙▌▙▖▌ ▙▌▌ █▌▙▌▌▌
             ▄▌    ▌
`);
}

/**
 * Creates a standard logger function prefixed with the extension UUID.
 * @param {string} uuid - The unique identifier of the GNOME Shell extension.
 * @returns {function(string): void} A function that logs strings to the system console.
 */
export function createLogger(uuid) {
    return message => {
        console.log(`[${uuid}] ${message}`);
    };
}

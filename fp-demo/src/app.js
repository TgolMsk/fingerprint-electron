// Electron's application loader does not guarantee Node's require.main identity.
// Keep the interactive entry explicit; tests import main.js without opening it.
require('./main').startStandalone();

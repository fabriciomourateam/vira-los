import {Config} from '@remotion/cli/config';
// Na nuvem do Claude: CHROME_BIN=/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell
if (process.env.CHROME_BIN) Config.setBrowserExecutable(process.env.CHROME_BIN);

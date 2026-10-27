import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

app.listen(config.API_PORT, () => {
  console.log(`api listening on http://localhost:${config.API_PORT}`);
});

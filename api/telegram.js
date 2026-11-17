import { telegram } from '../server/telegram.js';

export default {
  fetch(request) {
    return telegram(request, process.env);
  },
};

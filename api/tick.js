import { tick } from '../server/telegram.js';

export default {
  fetch(request) {
    return tick(request, process.env);
  },
};

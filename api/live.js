import { live } from '../server/live.js';

export default {
  fetch(request) {
    return live(request, process.env);
  },
};

import { read } from '../server/handlers.js';

export default {
  fetch(request) {
    return read(request, process.env);
  },
};

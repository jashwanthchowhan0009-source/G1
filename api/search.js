import { search } from '../server/handlers.js';

export default {
  fetch(request) {
    return search(request, process.env);
  },
};

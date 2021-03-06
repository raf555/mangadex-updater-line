module.exports = {
  closed: false, // any request to mangadex from front web or bot, true/false
  checker: true, // auto check: true: on, false: off
  endpointlist: [
    "https://api.mangadex.org/v2/",
    "https://mangadex.org/api/v2/"
  ], // api endpoint
  endpointidx: 1 // used endpoint at index
};

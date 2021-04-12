const axios = require("axios"),
  editJsonFile = require("edit-json-file"),
  endpoint = require(".").endpoint;

module.exports = {
  unfollowmanga: id => {
    return axios.get(
      "https://mangadex.org/ajax/actions.ajax.php?function=manga_unfollow&id=" +
        id +
        "&type=" +
        id,
      {
        headers: {
          Cookie: process.env.dex_cookies,
          "X-Requested-With": "XMLHttpRequest",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
        }
      }
    );
  },
  followmanga: id => {
    return axios.get(
      "https://mangadex.org/ajax/actions.ajax.php?function=manga_follow&id=" +
        id +
        "&type=1",
      {
        headers: {
          Cookie: process.env.dex_cookies,
          "X-Requested-With": "XMLHttpRequest",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
        }
      }
    );
  },
  getmanga: async id => {
    let data = await axios.get(
      endpoint + "/manga/" + id + "?include=chapters",
      {
        headers: {
          Cookie: process.env.dex_cookies,
          "X-Requested-With": "XMLHttpRequest",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
        }
      }
    );
    return data.data.data;
  },
  getgroupname: async id => {
    let grupdb = editJsonFile("db/_dexgroup.json");
    if (grupdb.get(id.toString())) {
      return grupdb.get(id.toString()).name;
    }
    let data = await axios.get(endpoint + "/group/" + id, {
      headers: {
        Cookie: process.env.dex_cookies,
        "X-Requested-With": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
      }
    });
    grupdb.set(id.toString() + ".name", data.data.data.name);
    grupdb.save();
    return data.data.data.name;
  },
  getfollowing: async () => {
    let data = await axios.get(
      endpoint + "/user/" + process.env.dex_uid + "/followed-manga",
      {
        headers: {
          Cookie: process.env.dex_cookies,
          "X-Requested-With": "XMLHttpRequest",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
        }
      }
    );
    return data.data.data;
  }
};

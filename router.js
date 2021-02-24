const express = require("express"),
  line_login = require("line-login"),
  session = require("express-session"),
  editJsonFile = require("edit-json-file"),
  { Mangadex } = require("mangadex-api"),
  line = require("@line/bot-sdk"),
  axios = require("axios"),
  NodeCache = require("node-cache");

const app = express.Router(),
  session_options = {
    secret: process.env.login_secret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 3600 * 1000 }
  },
  config = {
    channelAccessToken: process.env.acc_token,
    channelSecret: process.env.acc_secret
  },
  client = new line.Client(config),
  myCache = new NodeCache({ stdTTL: 86400 }),
  login = new line_login({
    channel_id: process.env.acc_id,
    channel_secret: process.env.login_secret,
    callback_url: process.env.login_callback,
    scope: "openid profile",
    //prompt: "consent",
    bot_prompt: "normal"
  }),
  mclient = new Mangadex();

app.use(session(session_options));

app.get("/dex.js", function(req, res) {
  if (!req.get("referer")) {
    res.sendStatus(404);
  } else {
    if (!req.get("referer").match("https://dex-line.glitch.me/")) {
      res.sendStatus(404);
    } else {
      res.sendFile(__dirname + "/public/static/dex.js");
    }
  }
});

app.get("/wake", function(req, res) {
  res.send({ result: true });
});

app.use("/login", login.auth());
app.get("/logout", function(req, res) {
  login
    .verify_access_token(req.session.acc_token)
    .then(result => {
      login.revoke_access_token(req.session.acc_token).then(() => {
        req.session.destroy();
        res.redirect("/login");
      });
    })
    .catch(err => {
      //console.log(err);
      res.redirect("/login");
    });
});

// manga limit
const limit = 10;

app.use(
  "/login_callback",
  login.callback(
    (req, res, next, token_response) => {
      req.session.acc_token = token_response.access_token;
      req.session.refresh_token = token_response.refresh_token;
      req.session.uid = token_response.id_token.sub;
      req.session.mis = token_response.id_token;
      //res.json(token_response);
      if (req.session.redir && req.session.redir != "/") {
        var redir = req.session.redir;
        req.session.redir = "/";
        res.redirect(redir);
      } else {
        res.redirect("/");
      }
    },
    (req, res, next, error) => {
      res.redirect("/login");
    }
  )
);

app.get("/", function(req, res) {
  login
    .verify_access_token(req.session.acc_token)
    .then(async result => {
      if (req.session.uid == process.env.admin_id) {
        let db = editJsonFile("db/_dexuser.json");
        let db2 = editJsonFile("db/_dexmanga.json");
        let data = Object.keys(db.get());
        let data2 = Object.keys(db2.get());
        let c = 0;
        let c2 = 0;
        let dex = true;
        let api = true;
        try {
          await axios.get("https://mangadex.org");
        } catch (e) {
          dex = false;
        }
        try {
          await axios.get("http://api.mangadex.org/v2/");
        } catch (e) {
          api = false;
        }
        for (let id of data) {
          if (Object.keys(db.get(id)).length > 0) {
            c += 1;
          }
        }
        for (let id of data2) {
          if (Object.keys(db2.get(id).follower).length > 0) {
            c2 += 1;
          }
        }
        res.render("index", {
          kuota: editJsonFile("db/pushlimit.json").get("quota"),
          user: c,
          manga: c2,
          dex: dex,
          api: api
        });
      } else {
        res.redirect("/dex");
      }
    })
    .catch(err => {
      res.redirect("/login");
    });
});

app.get("/dex", function(req, res) {
  login
    .verify_access_token(req.session.acc_token)
    .then(async result => {
      let searchu = "";
      let uid = req.session.uid;
      let _manga = editJsonFile("db/_dexmanga.json");
      let _user = editJsonFile("db/_dexuser.json");
      let add = false;
      try {
        let added = await client.getProfile(uid);
        if (editJsonFile("db/user.json").get(uid)) {
          add = true;
        }
      } catch (e) {
        add = false;
      }
      if (add) {
        // login
        try {
          await mclient.agent.login(
            process.env.dex_id,
            process.env.dex_pw,
            false
          );
        } catch (e) {
          res.send(
            '<center><h2>Failed to login to <a href="https://mangadex.org" target="_blank">Mangadex</a></h2><br><br>' +
              '<a class="twitter-timeline" data-width="500" data-height="500" data-theme="dark" href="https://twitter.com/MangaDex?ref_src=twsrc%5Etfw">Tweets by MangaDex</a> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>' +
              "</center>"
          );
          return false;
        }

        // if there is search param
        if (
          req.query.q &&
          req.query.q != "" &&
          req.query.s &&
          req.query.s == "1"
        ) {
          let search, query;
          query = parseurl(req.query.q);

          if (!query) {
            query = req.query.q;
          }

          if (isNaN(query)) {
            // search result
            try {
              search = await getsearch(query);
              // max search
              let byk = 5;
              let len = search.titles.length < byk ? search.titles.length : byk;
              for (let i = 0; i < len; i++) {
                let ada = false;
                if (
                  _manga.get(search.titles[i].id + ".follower." + uid) &&
                  _user.get(uid + "." + search.titles[i].id)
                ) {
                  ada = true;
                }

                searchu += searchout(search.titles[i], false, ada, false);
              }
            } catch (e) {
              searchu = "Failed to search manga..";
            }
          } else {
            try {
              search = await getmanga(query);
              if (!search.isHentai) {
                let ada = false;
                if (
                  _manga.get(query + ".follower." + uid) &&
                  _user.get(uid + "." + query)
                ) {
                  ada = true;
                }
                searchu += searchout(search, false, ada);
              }
            } catch (e) {
              if (e.response.status == 404) {
                searchu = "";
              } else {
                searchu = "Failed to get manga data..";
              }
            }
          }
          if (searchu == "") {
            searchu = "Can't find anything with query <b>" + query + "</b>";
          }
        } else if (req.query.s && req.query.s == "1" && req.query.self == 1) {
          if (_user.get(uid) && Object.keys(_user.get(uid)).length > 0) {
            let data = Object.keys(_user.get(uid));
            for (let i = 0; i < data.length; i++) {
              let search;
              try {
                search = await getmanga(data[i]);
                searchu += searchout(search);
              } catch (e) {
                searchu = "Failed to get manga data..";
                break;
              }
            }
          } else {
            searchu = "You haven't followed anything..";
          }
        }
      }
      res.render("dex", {
        out: searchu,
        q: req.query.q,
        added: add,
        limit: limit
      });
    })
    .catch(err => {
      req.session.uid = "";
      req.session.redir = "/dex";
      if (req.query.q && req.query.q != "") {
        req.session.redir += "?q=" + req.query.q;
      }
      res.redirect("/login");
    });
});

app.get("/api/dex/folunfol/:id", async (req, res) => {
  if (!req.session.uid) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  }
  try {
    let added = await client.getProfile(req.session.uid);
    if (!editJsonFile("db/user.json").get(req.session.uid)) {
      res.send({
        result: false,
        reason: "User is not registered in database."
      });
      return false;
    }
  } catch (e) {
    res.send({
      result: false,
      reason: "User has blocked / not added the bot."
    });
    return false;
  }
  var searchu = "";
  if (req.params.id) {
    var id = parseInt(req.params.id);

    // db
    let _manga = editJsonFile("db/_dexmanga.json");
    let _user = editJsonFile("db/_dexuser.json");

    let uid = req.session.uid; // uid
    let baru = false; // type

    if (isNaN(req.params.id) || req.params.id.match(/\./g)) {
      res.send({ result: false, reason: "invalid argument" });
      return false;
    }

    if (!(!_user.get(uid + "." + id) && !_manga.get(id + ".follower." + uid))) {
      // unfollow a manga
      _user.unset(uid + "." + id);
      _manga.unset(id + ".follower." + uid);

      if (Object.keys(_manga.get(id + ".follower")).length - 1 <= 0) {
        try {
          await unfolmanga(id);
        } catch (e) {
          res.send({ result: false, reason: "Unknown error occured" });
          return false;
        }
      }

      _manga.save();
      _user.save();
      res.send({ result: true, type: baru });
    } else {
      if (_user.get(uid) && Object.keys(_user.get(uid)).length >= limit) {
        res.send({ result: false, reason: "max" });
        return false;
      }

      try {
        await getmanga(id);
      } catch (e) {
        if (e.response.status == 404) {
          res.send({
            result: false,
            reason: "Manga with such id is not found."
          });
        }
        res.send({
          result: false,
          reason: "Unknown error occured"
        });
        return false;
      }

      try {
        await folmanga(id);
        if (
          !_user.get(uid + "." + id) &&
          !_manga.get(id + ".follower." + uid)
        ) {
          _user.set(uid + "." + id, 1);
          _manga.set(id + ".follower." + uid, 1);
          _manga.save();
          _user.save();
          baru = true;
        }
        res.send({ result: true, type: baru });
      } catch (e) {
        res.send({ result: false, reason: "Unknown error occured" });
      }
    }
  }
});

function parseurl(url, int = true) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  let hostname, pathname;
  hostname = parsed.hostname;
  pathname = parsed.pathname;
  if (hostname == "mangadex.org") {
    if (pathname) {
      pathname = pathname.substring(1);
      let split = pathname.split("/");
      if (split.length >= 2) {
        if (split[0] == "title") {
          if (!isNaN(split[1])) {
            return int ? parseInt(split[1]) : split[1];
          }
        }
      }
    }
  }
  return null;
}

function searchout(searchdata, fromself = true, ada, fromgetmanga = true) {
  let db = editJsonFile("db/_dexmanga.json");
  let trimString = (string, length) => {
    return string.length > length
      ? string.substring(0, length) + "... "
      : string;
  };

  let count = id => {
    try {
      db.get("" + id);
      return Object.keys(db.get(id + ".follower")).length;
    } catch (e) {
      return 0;
    }
  };

  let findlatest = data => {
    for (let i in data.chapters) {
      if (
        data.chapters[i].language == "gb" ||
        data.chapters[i].language == "en"
      ) {
        return datetostr(
          convertTZ(new Date(data.chapters[i].timestamp * 1000), "Asia/Jakarta")
        );
      }
    }
  };

  let search = fromgetmanga ? searchdata.manga : searchdata;

  // remove dex lang tag
  search.description = search.description.replace(/\[[^\]]+\]/g, "");

  let out =
    '<div class="item">' +
    '<div class="image">' +
    '<img src="' +
    (search.mainCover || search.image_url) +
    '" />' +
    "</div>" +
    '<div class="content">' +
    '<a class="header" target="_blank" href="https://mangadex.org/title/' +
    search.id +
    '">' +
    search.title +
    "</a>" +
    '<div class="meta">' +
    "<p>" +
    '<a style="color:#666666" title="Rating"><i class="star icon"></i> ' +
    (search.rating.bayesian || search.rating.value)
      .toString()
      .replace(".", ",") +
    "</a>" +
    '<a style="color:#666666" title="Views"><i class="eye icon"></i> ' +
    search.views.toLocaleString("id-ID") +
    '<a style="color:#666666" title="Follower" id="' +
    search.id +
    '"><i class="bookmark icon"></i> ' +
    count(search.id) +
    "</a>" +
    "</p>" +
    "</div>" +
    '<div class="description">' +
    "<p>" +
    trimString(search.description, 275) +
    (search.description.length >= 275
      ? '<a href="https://mangadex.org/title/' +
        search.id +
        '" target="_blank">See more</a>'
      : "") +
    //search.description +
    "</p>" +
    "</div>" +
    '<div class="extra">' +
    '<div class="left floated content" style="' +
    (!fromself ? "display:none" : "") +
    '">Latest update: ' +
    (fromself ? findlatest(searchdata) + " UTC+7" : "") +
    "</div>" +
    '<div class="right floated content">' +
    (fromself
      ? '<button class="ui folunfol yellow button" data-id="' +
        search.id +
        '">' +
        '<i class="bookmark icon"></i> Unfollow' +
        "</button>"
      : '<button class="ui folunfol ' +
        (ada ? "yellow" : "green") +
        ' button" data-id="' +
        search.id +
        '">' +
        '<i class="bookmark icon"></i>' +
        (ada ? "Unfollow" : "Follow") +
        "</button>") +
    "</div></div>" +
    "</div>" +
    "</div>";
  return out;
}

function unfolmanga(id) {
  let _manga = editJsonFile("features/_dexmanga.json");
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
}

function folmanga(id) {
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
}

async function getmanga(id, fromcache = true) {
  if (fromcache) {
    if (myCache.has("manga-" + id)) {
      let out = myCache.get("manga-" + id);
      //out.cache = true;
      return out;
    }
  }
  let data = await axios.get(
    "https://api.mangadex.org/v2/manga/" + id + "?include=chapters",
    {
      headers: {
        Cookie: process.env.dex_cookies,
        "X-Requested-With": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
      }
    }
  );
  myCache.set("manga-" + id, data.data.data);
  return data.data.data;
}

async function getsearch(q, fromcache = true) {
  if (fromcache) {
    if (myCache.has("search-" + q)) {
      let out = myCache.get("search-" + q);
      //out.cache = true;
      return out;
    }
  }
  let search = await mclient.search({
    title: q,
    with_hentai: false
  });
  myCache.set("search-" + q, search);
  return search;
}

async function ambilfollow() {
  let tes = await axios.get(
    "https://api.mangadex.org/v2/user/" +
      process.env.dex_uid +
      "/followed-manga",
    {
      headers: {
        Cookie: process.env.dex_cookies,
        "X-Requested-With": "XMLHttpRequest",
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
      }
    }
  );
  return tes.data.data;
}

function convertTZ(date, tzString) {
  return new Date(
    (typeof date === "string" ? new Date(date) : date).toLocaleString("en-US", {
      timeZone: tzString
    })
  );
}

// convert Date to string
function dateTodate(d) {
  let tgl = d.getDate() < 10 ? "0" + d.getDate() : d.getDate();
  let mon = d.getMonth() + 1 < 10 ? "0" + (d.getMonth() + 1) : d.getMonth() + 1;
  return tgl + "-" + mon + "-" + d.getFullYear();
}

function dateTohour(d) {
  let jam = d.getHours() < 10 ? "0" + d.getHours() : d.getHours();
  let mnt = d.getMinutes() < 10 ? "0" + d.getMinutes() : d.getMinutes();
  return jam + "." + mnt;
}

function datetostr(d) {
  return dateTodate(d) + " - " + dateTohour(d);
}

module.exports = app;

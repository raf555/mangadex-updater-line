const express = require("express"),
  app = express.Router(),
  line_login = require("line-login"),
  session = require("express-session"),
  session_options = {
    secret: process.env.login_secret,
    resave: false,
    saveUninitialized: false
  },
  editJsonFile = require("edit-json-file"),
  { Mangadex } = require("mangadex-api"),
  line = require("@line/bot-sdk"),
  axios = require("axios"),
  config = {
    channelAccessToken: process.env.acc_token,
    channelSecret: process.env.acc_secret
  },
  client = new line.Client(config),
  NodeCache = require("node-cache"),
  myCache = new NodeCache({ stdTTL: 86400 });

const login = new line_login({
  channel_id: process.env.acc_id,
  channel_secret: process.env.login_secret,
  callback_url: process.env.login_callback,
  scope: "openid profile",
  //prompt: "consent",
  bot_prompt: "normal"
});

const mclient = new Mangadex();

// manga limit
let limit = 10;

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

app.use(session(session_options));

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

app.use(
  "/login_callback",
  login.callback(
    (req, res, next, token_response) => {
      req.session.acc_token = token_response.access_token;
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
      // Failure callback
      //console.log(error);
      res.redirect("/");
      //res.status(400).json(error);
    }
  )
);

app.get("/", function(req, res) {
  login
    .verify_access_token(req.session.acc_token)
    .then(result => {
      if (req.session.uid == process.env.admin_id) {
        let db = editJsonFile("db/_dexuser.json");
        let data = Object.keys(db.get());
        let c = 0;
        for (let id of data) {
          if (Object.keys(db.get(id)).length > 0) {
            c += 1;
          }
        }
        res.render("index", {
          kuota: editJsonFile("db/pushlimit.json").get("quota"),
          user: c
        });
      } else {
        res.redirect("/dex");
      }
    })
    .catch(err => {
      //console.log(err);
      res.redirect("/login");
    });
});

app.get("/dex", function(req, res) {
  login
    .verify_access_token(req.session.acc_token)
    .then(result => {
      (async () => {
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
          await mclient.agent.login(
            process.env.dex_id,
            process.env.dex_pw,
            false
          );

          // if there is search param
          if (
            req.query.q &&
            req.query.q != "" &&
            req.query.s &&
            req.query.s == "1"
          ) {
            let search;
            if (isNaN(req.query.q)) {
              // search result
              search = await getsearch(req.query.q);
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

                searchu += searchout(search.titles[i], false, ada);
              }
            } else {
              try {
                search = await getmanga(req.query.q);
                if (!search.isHentai) {
                  let ada = false;
                  if (
                    _manga.get(req.query.q + ".follower." + uid) &&
                    _user.get(uid + "." + req.query.q)
                  ) {
                    ada = true;
                  }
                  searchu += searchout(search, false, ada);
                }
              } catch (e) {
                searchu = "";
              }
            }
            if (searchu == "") {
              searchu =
                "Can't find anything with query <b>" + req.query.q + "</b>";
            }
          } else {
            if (_user.get(uid) && Object.keys(_user.get(uid)).length > 0) {
              let data = Object.keys(_user.get(uid));
              for (let i = 0; i < data.length; i++) {
                let search;
                try {
                  search = await getmanga(data[i]);
                  searchu += searchout(search);
                } catch (e) {
                  searchu = "Failed to get manga data, please refresh the page";
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
      })();
    })
    .catch(err => {
      //console.log(err);
      req.session.uid = "";
      req.session.redir = "/dex";
      if (req.query.q && req.query.q != "") {
        req.session.redir += "?q=" + req.query.q;
      }
      res.redirect("/login");
    });
});

app.get("/api/dex/folunfol/:id", function(req, res) {
  if (!req.session.uid) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  }
  (async () => {
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

      // login
      await mclient.agent.login(process.env.dex_id, process.env.dex_pw, false);

      // db
      let _manga = editJsonFile("db/_dexmanga.json");
      let _user = editJsonFile("db/_dexuser.json");

      let uid = req.session.uid; // uid
      let baru = false; // type

      if (isNaN(req.params.id) || req.params.id.match(/\./g)) {
        res.send({ result: false, reason: "invalid parameter" });
        return false;
      }

      if (
        !(!_user.get(uid + "." + id) && !_manga.get(id + ".follower." + uid))
      ) {
        // unfollow a manga
        _user.unset(uid + "." + id);
        _manga.unset(id + ".follower." + uid);
        _manga.save();
        _user.save();

        if (Object.keys(_manga.get(id + ".follower")).length - 1 <= 0) {
          await unfolmanga(id);
        }
        res.send({ result: true, type: baru });
      } else {
        if (_user.get(uid) && Object.keys(_user.get(uid)).length >= limit) {
          res.send({ result: false, reason: "max" });
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
  })();
});

function searchout(search, fromgetmanga = true, ada) {
  let trimString = function(string, length) {
    return string.length > length
      ? string.substring(0, length) + "... "
      : string;
  };

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
    '<a style="color:#666666"><i class="star icon"></i> ' +
    (search.rating.bayesian || search.rating.value) +
    "</a>" +
    '<a style="color:#666666"><i class="eye icon"></i> ' +
    search.views +
    "</a>" +
    "</p>" +
    "</div>" +
    '<div class="description">' +
    "<p>" +
    trimString(search.description, 400) +
    (search.description.length >= 400
      ? '<a href="https://mangadex.org/title/' +
        search.id +
        '" target="_blank">See more</a>'
      : "") +
    //search.description +
    "</p>" +
    "</div>" +
    '<div class="extra">' +
    (fromgetmanga
      ? '<button class="ui right floated yellow button folunfol" data-id="' +
        search.id +
        '">' +
        '<i class="bookmark icon"></i> Unfollow' +
        "</button>"
      : '<button class="ui right floated folunfol ' +
        (ada ? "yellow" : "green") +
        ' button" data-id="' +
        search.id +
        '">' +
        '<i class="bookmark icon"></i>' +
        (ada ? "Unfollow" : "Follow") +
        "</button>") +
    "</div>" +
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
  let data = await axios.get("https://api.mangadex.org/v2/manga/" + id, {
    headers: {
      Cookie: process.env.dex_cookies,
      "X-Requested-With": "XMLHttpRequest",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36"
    }
  });
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

module.exports = app;

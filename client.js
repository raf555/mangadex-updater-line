const express = require("express"),
  line_login = require("line-login"),
  session = require("express-session"),
  editJsonFile = require("edit-json-file"),
  { Mangadex } = require("mangadex-api"),
  line = require("@line/bot-sdk"),
  axios = require("axios"),
  NodeCache = require("node-cache"),
  mangadexapi = require("./utility/mangadex.js"),
  util = require("./utility");

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
  mclient = new Mangadex(),
  // bot / site status
  closed = util.closed,
  check = util.checker,
  // api endpoint
  endpoint = util.endpoint,
  // manga limit
  limit = util.limit;

// mangadex login
mclient.agent.login(process.env.dex_id, process.env.dex_pw, false);

/* node session */
app.use(session(session_options));

/* for frontend js */
app.get("/dex.js", function(req, res) {
  res.sendFile(__dirname + "/public/static/dex.js");
});

/* admin router */
app.use(require("./admin"));

/* login router */
app.use("/login", login.auth());

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

app.get("/logout", isloggedin, function(req, res) {
  login.revoke_access_token(req.session.acc_token).then(() => {
    req.session.destroy();
  });
  res.redirect("/login");
});

/* dashboard */
app.get("/", isloggedin, async (req, res) => {
  if (util.isAdmin(req.session.uid)) {
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
      await axios.get(endpoint);
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
    let pushdb = editJsonFile("db/pushlimit.json");
    let pushdata = pushdb.get("data");
    let avg = 0;
    for (let i in pushdata) {
      avg += pushdata[i];
    }
    avg /= pushdata.length;
    res.render("index", {
      kuota: pushdb.get("quota"),
      user: c,
      manga: c2,
      dex: dex,
      api: api,
      avg: avg
    });
  } else {
    res.redirect("/dex");
  }
});

/* front page */
app.get("/dex", isloggedin, async (req, res) => {
  // login
  /*
  try {
    await mclient.agent.login(process.env.dex_id, process.env.dex_pw, false);
  } catch (e) {
    res.sendFile(__dirname + "/public/error.html");
    return false;
  }*/

  let _manga = editJsonFile("db/_dexmanga.json");
  let _user = editJsonFile("db/_dexuser.json");

  let searchu = "";
  let uid = req.session.uid;
  let userdb = editJsonFile("db/user.json");
  let add = userdb.get(uid) && !userdb.get(uid + ".block");
  let cache = !(req.query.nocache && req.query.nocache == 1); // refresh cache
  let darkmode = req.query.dark && req.query.dark == 1;

  if (add) {
    // if there is search param
    if (
      req.query.q &&
      req.query.q != "" &&
      req.query.s &&
      req.query.s == "1" &&
      /https:\/\/dex-line.glitch\.me/.test(req.get("referer"))
    ) {
      let search, query;
      query = parseurl(req.query.q);

      if (!query) {
        query = req.query.q;
      }

      if (isNaN(query)) {
        // search result
        try {
          search = await getsearch(query, cache);
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

            searchu += await searchout(
              darkmode,
              req.session.uid,
              search.titles[i],
              false,
              ada,
              false
            );
          }
        } catch (e) {
          searchu = "Failed to search manga..";
        }
      } else {
        try {
          search = await getmanga(query, cache);
          if (!search.isHentai) {
            let ada = false;
            if (
              _manga.get(query + ".follower." + uid) &&
              _user.get(uid + "." + query)
            ) {
              ada = true;
            }
            searchu += await searchout(
              darkmode,
              req.session.uid,
              search,
              !!_manga.get(query) &&
                req.query.refresh &&
                req.query.refresh == 1,
              ada
            );
          }
        } catch (e) {
          if (e.response && e.response.status == 404) {
            searchu = "";
          } else {
            searchu = "Failed to get manga data..";
          }
        }
      }
      if (searchu == "") {
        searchu = "Can't find anything with query <b>" + query + "</b>";
      }
    } else if (
      req.query.s &&
      req.query.s == "1" &&
      req.query.self &&
      req.query.self == 1 &&
      /https:\/\/dex-line.glitch\.me/.test(req.get("referer"))
    ) {
      if (_user.get(uid) && Object.keys(_user.get(uid)).length > 0) {
        let data = Object.keys(_user.get(uid));
        for (let i = 0; i < data.length; i++) {
          let search;
          try {
            search = await getmanga(data[i], cache);
            searchu += await searchout(darkmode, req.session.uid, search);
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
    limit: limit,
    check: check,
    user: {
      name: userdb.get(uid).name || "Guest",
      avatar:
        userdb.get(uid).pic ||
        "https://mulder-onions.com/wp-content/uploads/2017/02/White-square.jpg"
    }
  });
});

/************************************** api ********************************************/

/* follow / unfollow manga */
app.get("/api/dex/folunfol/:id", async (req, res) => {
  if (!req.get("referer")) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  } else {
    if (!/https:\/\/dex-line.glitch\.me/.test(req.get("referer"))) {
      res.send({ result: false, reason: "Unauthorized" });
      return false;
    }
  }
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
  if (req.params.id) {
    let id = parseInt(req.params.id);

    // db
    let _manga = editJsonFile("db/_dexmanga.json");
    let _user = editJsonFile("db/_dexuser.json");

    let uid = req.session.uid; // uid
    let baru = false; // type

    if (isNaN(req.params.id) || req.params.id.match(/\./g) || id < 0) {
      res.send({ result: false, reason: "invalid argument" });
      return false;
    }

    if (!(!_user.get(uid + "." + id) || !_manga.get(id + ".follower." + uid))) {
      // unfollow a manga
      _user.unset(uid + "." + id);
      _manga.unset(id + ".follower." + uid);
      if (Object.keys(_manga.get(id + ".follower")).length - 1 <= 0) {
        try {
          await unfolmanga(id);
          _manga.unset(req.params.id);
          console.log(
            "Manga with id " + req.params.id + " is unfollowed from dex"
          );
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
      let following;
      try {
        following = await ambilfollow();
      } catch (e) {
        res.send({ result: false, reason: "Unknown error occured" });
        return false;
      }
      let mangafound = following.find(data => data.mangaId == id) != undefined;
      _user.set(uid + "." + id + ".group", "-");
      _manga.set(id + ".follower." + uid, 1);
      if (!mangafound) {
        try {
          await folmanga(id);
          console.log(
            "Manga with id " + req.params.id + " is followed from dex"
          );
        } catch (e) {
          res.send({ result: false, reason: "Unknown error occured" });
          return false;
        }
      }
      _manga.save();
      _user.save();
      baru = true;
      res.send({ result: true, type: baru });
    }
  }
});

/* set group */
app.get("/api/dex/setgroup/:mangid/:grupid", async (req, res) => {
  if (!req.get("referer")) {
    res.send({ result: false, reason: "Unauthorized" });
    return false;
  } else {
    if (!/https:\/\/dex-line.glitch\.me/.test(req.get("referer"))) {
      res.send({ result: false, reason: "Unauthorized" });
      return false;
    }
  }
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
  if (req.params.mangid && req.params.grupid) {
    let _manga = editJsonFile("db/_dexmanga.json");
    let _user = editJsonFile("db/_dexuser.json");
    let _grup = editJsonFile("db/_dexgroup.json");
    let uid = req.session.uid;

    let mangid = req.params.mangid;
    let grupid = req.params.grupid;

    if (
      !(
        !_user.get(uid + "." + mangid) ||
        !_manga.get(mangid + ".follower." + uid)
      )
    ) {
      if (grupid == "-") {
        _user.set(uid + "." + mangid + ".group", "-");
        _user.save();
        res.send({ result: true, reason: "" });
        return false;
      } else {
        if (
          isNaN(mangid) ||
          mangid.match(/\./g) ||
          mangid < 0 ||
          isNaN(grupid) ||
          grupid.match(/\./g) ||
          grupid < 0
        ) {
          res.send({ result: false, reason: "invalid argument" });
          return false;
        } else {
          if (!_grup.get(grupid.toString())) {
            res.send({ result: false, reason: "invalid argument" });
            return false;
          }
          _user.set(uid + "." + mangid + ".group", grupid);
          _user.save();
          res.send({ result: true, reason: "" });
        }
      }
    } else {
      res.send({ result: false, reason: "Manga has not followed" });
      return false;
    }
  } else {
    res.send({ result: false, reason: "invalid argument" });
    return false;
  }
});

/* cache refresh for manga update */
app.get("/api/cache/refresh/:id", async (req, res) => {
  try {
    let id = req.params.id;
    if (myCache.has("manga-" + id)) {
      myCache.del("manga-" + id);
    }
    let data = await getmanga(id);
    console.log("Manga cache with id " + id + " is just updated");
    res.send(data);
  } catch (e) {
    res.send({ res: "no" });
  }
});

/* relogin to dex */
app.get("/api/dex/relogin", async (req, res) => {
  let resu = false;
  if (/https:\/\/dex-line.glitch\.me/.test(req.get("referer"))) {
    try {
      await mclient.agent.login(process.env.dex_id, process.env.dex_pw, false);
      resu = true;
    } catch (e) {
      console.log(e);
      console.log("Failed to relogin");
    }
  }
  res.send({ result: resu });
});

/************************************* other **************************************/

/* mangadex status */
app.get("/dexstatus", async (req, res) => {
  let dex = true;
  let api = true;
  try {
    await axios.get("https://mangadex.org");
  } catch (e) {
    dex = false;
  }
  try {
    await axios.get(endpoint);
  } catch (e) {
    api = false;
  }
  let fail = "none";
  if (!dex && !api) {
    fail = "both";
  } else {
    if (!dex) {
      fail = "dex";
    } else if (!api) {
      fail = "api";
    }
  }
  res.send({ result: dex && api, fail: fail });
});

/************************************* methods **************************************/

async function isloggedin(req, res, next) {
  if (closed) {
    res.sendFile(__dirname + "/public/error.html");
  } else {
    try {
      let data = await login.verify_access_token(req.session.acc_token);
      next();
    } catch (e) {
      switch (req.path) {
        case "/":
          req.session.redir = "/";
          break;
        case "/dex":
          req.session.redir = "/dex";
          if (req.query.q && req.query.q != "") {
            req.session.redir += "?q=" + req.query.q;
          }
          break;
      }
      res.redirect("/login");
    }
  }
}

async function makegrupoption(id, mangaid, data) {
  try {
    let uid = id;
    let userdb = editJsonFile("db/_dexuser.json");
    let grupdb = editJsonFile("db/_dexgroup.json");

    let out = "";
    out +=
      '<option value="-" ' +
      (userdb.get(uid + "." + mangaid + ".group") == "-" ? "selected" : "") +
      ">× None</option>";
    let chapt = data.chapters;
    let grup = [];
    for (let i in chapt) {
      if (grup.indexOf(chapt[i].groups[0]) == -1 && chapt[i].language == "gb")
        grup.push(chapt[i].groups[0]);
    }
    for (let i in grup) {
      if (!grupdb.get(grup[i].toString())) {
        let name = await getgroupname(grup[i]);
        grupdb.set(grup[i] + ".name", name);
        grupdb.save();
      }
      out +=
        '<option value="' +
        grup[i].toString() +
        '" ' +
        (grup[i].toString() == userdb.get(uid + "." + mangaid + ".group")
          ? "selected"
          : "") +
        ">" +
        grupdb.get(grup[i].toString()).name +
        "</option>";
    }
    return out;
  } catch (e) {
    return null;
  }
}

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

async function searchout(
  dark,
  id,
  searchdata,
  fromself = true,
  ada = true,
  fromgetmanga = true
) {
  let db = editJsonFile("db/_dexmanga.json");
  let userdb = editJsonFile("db/_dexuser.json");

  let trimString = (string, length) => {
    return string.length > length
      ? string.substring(0, length) + "... "
      : string;
  };

  let count = id => {
    if (db.get(id.toString())) {
      return Object.keys(db.get(id + ".follower")).length;
    }
    return 0;
  };

  let findlatest = data => {
    let usergrup = userdb.get(id + "." + data.manga.id).group;
    let custgrup = false;
    if (usergrup != "-") {
      custgrup = true;
    }
    for (let i in data.chapters) {
      if (
        data.chapters[i].language == "gb" ||
        data.chapters[i].language == "en"
      ) {
        let latestchapt = "Chapter " + data.chapters[i].chapter;
        if (data.chapters[i].title) {
          latestchapt += " - " + data.chapters[i].title;
        }
        if (!custgrup) {
          return [
            datetostr(
              convertTZ(
                new Date(data.chapters[i].timestamp * 1000),
                "Asia/Jakarta"
              )
            ),
            latestchapt
          ];
        } else {
          if (data.chapters[i].groups[0].toString() != usergrup) {
            continue;
          } else {
            return [
              datetostr(
                convertTZ(
                  new Date(data.chapters[i].timestamp * 1000),
                  "Asia/Jakarta"
                )
              ),
              latestchapt
            ];
          }
        }
      }
    }
  };

  let search = fromgetmanga ? searchdata.manga : searchdata;
  let latest = fromself ? findlatest(searchdata) : null;

  // remove dex lang tag
  search.description = search.description.replace(/\[[^\]]+\]/g, "");

  let url = "https://mangadex.org/title/" + search.id;

  if (fromself && !latest) {
    latest = [];
    latest[0] = "01-01-1970 - 00.00";
    latest[1] = "No latest English chapter found, please unfollow this manga.";
  }

  let out =
    '<div class="item list">' +
    '<div class="image">' +
    '<img src="' +
    (search.mainCover || search.image_url) +
    '" />' +
    "</div>" +
    '<div class="content">' +
    '<a class="header" target="_blank" href="' +
    url +
    '">' +
    search.title +
    '<span style="display:none">' +
    url +
    "</span></a>" +
    '<div class="meta">' +
    "<p>" +
    '<span title="Rating" style="cursor:pointer"><i class="star icon"></i> ' +
    (search.rating.bayesian || search.rating.value)
      .toFixed(2)
      .replace(".", ",") +
    "</span>" +
    '<span title="Views" style="cursor:pointer"><i class="eye icon"></i> ' +
    search.views.toLocaleString("id-ID") +
    "</span>" +
    '<span title="Follower" style="cursor:pointer" id="' +
    search.id +
    '"><i class="bookmark icon"></i> ' +
    count(search.id) +
    "</span>" +
    (!fromself
      ? ""
      : '<br><span title="Latest Chapter" style="cursor:pointer"><i class="sync alternate icon"></i> ' +
        latest[1] +
        "</span>") +
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
    (!fromself
      ? ""
      : '<div class="ui left floated label lastup" style="cursor:pointer;" data-id="' +
        search.id +
        '" title="Click to refresh data">Last updated on ' +
        latest[0] +
        "</div>") +
    '<button class="ui right floated folunfol ' +
    (ada ? "yellow" : "green") +
    " button " +
    (dark ? "inverted" : "") +
    '" data-id="' +
    search.id +
    '">' +
    '<i class="bookmark icon"></i>' +
    (ada ? "Unfollow" : "Follow") +
    "</button>" +
    (!fromself
      ? ""
      : '<br><br><div class="ui left floated accordion field ' +
        (dark ? "inverted" : "") +
        '">' +
        '<div class="title">' +
        '<i class="icon dropdown"></i>' +
        "Advanced Option" +
        "</div>" +
        '<div class="content field">' +
        "<label>Get update only from certain group: </label><br>" +
        '<select class="ui dropdown ' +
        (dark ? "inverted" : "") +
        '" data-id="' +
        search.id +
        '">' +
        (await makegrupoption(id, search.id.toString(), searchdata)) +
        "</select>" +
        "</div>" +
        "</div>") +
    "</div>" +
    "</div>" +
    "</div>";
  return out;
}

function unfolmanga(id) {
  return mangadexapi.unfollowmanga(id);
}

function folmanga(id) {
  return mangadexapi.followmanga(id);
}

async function getmanga(id, fromcache = true) {
  if (fromcache) {
    if (myCache.has("manga-" + id)) {
      let out = myCache.get("manga-" + id);
      return out;
    }
  }
  let data = await mangadexapi.getmanga(id);
  myCache.set("manga-" + id, data);
  return data;
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

async function getgroupname(id) {
  return await mangadexapi.getgroupname(id);
}

async function ambilfollow() {
  return await mangadexapi.getfollowing();
}

function convertTZ(date, tzString) {
  return util.convertTZ(date, tzString);
}

// convert Date to string
function dateTodate(d) {
  return util.dateTodate(d);
}

function dateTohour(d) {
  return util.dateTohour(d);
}

function datetostr(d) {
  return util.datetostr(d);
}

module.exports = app;

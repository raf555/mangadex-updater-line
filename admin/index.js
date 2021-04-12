const express = require("express"),
  editJsonFile = require("edit-json-file"),
  axios = require("axios"),
  app = express.Router(),
  util = require("../utility");

/* admin router */
app.get("/api/admin/viewdb/:name", async (req, res) => {
  if (req.session.uid && util.isAdmin(req.session.uid)) {
    res.sendFile(__dirname + "/db/" + req.params.name);
  } else {
    res.sendStatus(403);
  }
});

app.get("/api/admin/setpushquota/:quota", async (req, res) => {
  if (req.session.uid && util.isAdmin(req.session.uid)) {
    let pushdb = editJsonFile("db/pushlimit.json");
    pushdb.set("quota", parseInt(req.params.quota));
    pushdb.save();
    res.sendStatus(200);
  } else {
    res.sendStatus(403);
  }
});

module.exports = app;

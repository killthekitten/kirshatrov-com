---
layout: post
title: "Working on fork and upstream"
date: 2016-11-20
comments: true
published: true
---

When you fork a repo, Github makes your own copy of the project.
If you forked Rails in 2014, your fork is now 2 years outdated
unless you synced it with the original repo (called upstream).

In this post, I'll show the efficient way to sync your fork with the upstream.

When I clone my fork, I create two upstreams: for my fork and for the upstream (original repo).

```
$ git clone git@github.com:kirs/rails.git
$ cd rails
# create remote for the original repo
$ git remote add upstream git@github.com:rails/rails.git
```

And then comes my awesome script that updates my fork:

```bash
#!/usr/bin/env bash
# set bash to strict mode
set -eu
set -v

# make sure we're on master
git checkout master
# pull original repo
git fetch upstream
# sync your master with upstream master and force push
git reset --hard upstream/master
git push origin master --force
```

I put that script to `~/.bin/sync-upstream` with `~/.bin` added to my `$PATH`.
Now I can call `sync-upstream` from any directory.

I have two usecases to use the script:

1) When my PR was merged and I'd like to get a fresh `master` that includes my changes
2) When I haven't been working on the project for a while and I want to make sure that I don't sent new PR
based on the old codebase.

Happy forking!

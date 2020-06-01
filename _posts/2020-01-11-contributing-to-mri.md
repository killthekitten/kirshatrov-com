---
layout: post
title: Contributing to Ruby MRI
date: 2020-01-11
comments: true
published: true
---

I've recently worked on (so far) my biggest [patch](https://github.com/ruby/ruby/pull/2827){:target="_blank"} to Ruby MRI. While the changeset is only 50 lines of code it took me a few days and couple takes to figure out the right way to make `getaddrinfo` interrupt and fail fast when DNS is unhealthy.

It's often unclear where to start when you're about to contribute to some large codebase in C. This post is a collection of notes, mostly for myself, on how to contribute code to Ruby.

* `make` is your best friend. For any project, usually I like to start from reading the Makefile, but Ruby is using `autoconf` to generate platform-dependent Makefile, so 1) at the start you don't even have a Makefile 2) the generated one is not too readable. Still, learn and get to understand what `make` and `make install` do generally.
* At least for my patch, I've had to develop and run it on Linux since it was specific to the OS. My primary computer is Mac and the usual choice would be to run a devbox VM and write my code there. I'm not always a fan of VMs because it takes extra time to configure and it's trickier to use your favorite editor with it (unless you have a portable VIM config).

	I've recently tweeted about how awesome is VS Code's [devcontainers feature](https://code.visualstudio.com/docs/remote/containers){:target="_blank"}, and I wanted to try that for MRI too. It took me a single `docker compose up` and "Attach to container" in VS Code to allow to keep writing code in my editor while being able to build and test on Linux. That made me a lot comfortable working on the project. Check out the [docker-compose.yml](https://gist.github.com/kirs/3912e1a44b67fda906ab4f6aad09ebaf){:target="_blank"} I've used.

  Below is a screenshot of how a running Ubuntu container integrates with the editor.

<img src="/assets/post-images/dev-container-mri.png" alt="VS Code devcontainer feature" class="bordered" />

* After you make changes, you'd usually want to run tests. I know how to run tests for Rails (`bin/rails test test/...`) and for Minitest (`bundle exec ruby -Itest test/...`), but from what I know, every C project in different and MRI has its own test framework. `make test-all` and `make test-all TESTS='test/path/to/test'` is the way to run tests here (more on that below)
* Koichi's [ruby hack challenge repo](https://github.com/ko1/rubyhackchallenge/tree/master/EN){:target="_blank"} is a gem when it comes to "how do I even develop this?". It contains multiple guides on what's the MRI structure, how to build it, how to test it and so on. You can forget what's my post about, but if you're interested in contributing to MRI, **that's the repo that you should star**.
* Here's the flow I used:

```bash
$ make # build within current directory
$ make install-nodoc # install built files skipping rdoc which takes time
./ruby my-script-to-reproduce.rb # run something on locally built ruby
$ make test-all # run all tests, thought that will take a while
$ make test-all TESTS='test/socket/test_socket.rb' # run socket-related tests

# push to github, let the CI generate more failed tests
# run tests locally again and try to fix it
```

* [The Ruby C API](https://silverhammermba.github.io/emberb/c/){:target="_blank"} is super valuable when it comes to hacking on internals and also to writing native gems.

Hope this has been helpful. Even if you don't have a patch to contribute in mind, it's still very fun to learn how the language actually work, and to find how Ruby is actually implemented in C. There's nothing in C to be afraid of.

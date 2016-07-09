---
layout: post
title: "Rails and Webpack: No Gem Required"
date: 2016-07-09
comments: true
published: true
---

Developing a Rails project with a rich client side features, at some point you may want to replace the Asset Pipeline
with a modern Node.js-based asset compilation toolkit. [Webpack](https://webpack.github.io/) is a great example of an asset compilation tool.

There are a lot of opinions about issues with Asset Pipeline. Some of the reasons are: it doesn't scale well for SPA applications; it doesn't support require/commonjs modules and asset bundling (using `require "component.css"` from `component.js`).

This is it: one day you decide switch to Webpack in your Rails app. How do you start?
For majority of developers, the easiest way is to start with a gem. The most popular one is [webpack-rails](https://github.com/mipearson/webpack-rails).

But in [our](http://onboardiq.com) case, the problem with the gem was that it required us to change the workflow. Instead of simply running `rails server` you would need to manage processes with  [`foreman`](https://github.com/mipearson/webpack-rails#using-webpack-rails).
It's the same reason why I wrote a post about [ActiveRecord fields encryption](http://blog.iempire.ru/2015/12/18/simple-rails-encryption/). I do not like using universal gems with hidden logic that just works (tm) because in most cases you can implement it with a small snippet avoiding introducing a new dependency that you'd have to upgrade and maintain in the future.

I saw no need in using an extra dependency here, because a basic integration with Webpack is quite fast-forward.

Working on [OnboardIQ](http://onboardiq.com) in 2015, we came up with a solution that I want to share in this post.
**All of Webpack and Rails integration is just a set of techniques and helpers that tie them together.**

# The asset helper

In development, Webpack requires running a separate process that would compile changed assets and as a developer who is not famillar with Webpack it's easy to forget to run or restart the Webpack process.

I decided to fix it on the Rails side. The idea is to inform the developer is the webpack process is not running.

{% highlight ruby %}
module ApplicationHelper
  def webpack_bundle_tag(src, options = {})
    Webpack.check_if_running! if Rails.env.development?
    javascript_include_tag(src, options)
  end
end
{% endhighlight %}

{% highlight ruby %}
module Webpack
  class NotRunningError < StandardError;end

  class << self
    def process_running?
      `ps aux | grep "webpac[k]" | wc -l`.strip.to_i > 0
    end

    def check_if_running!
      # `npm run development` starts the webpack process
      unless process_running?
        raise NotRunningError, "webpack is not running. Please run 'npm install && npm run webpack-development'"
      end
    end
  end
end
{% endhighlight %}

Then you proxy all calls to webpack-generated assets with `webpack_bundle_tag` (instead of `<%= javascript_include_tag 'application' %>`) in your views and the developer will immediatelly know if he/she forgot to start the process. This is especially helpful in case when your new developer does not have a background in asset management and webpack.


# Detecting errors

When you're browsing in your Rails app and modifying assets, Webpack will recompile JS when the files are changed. Since it's not very likely that you will monitor the Webpack output, sometimes you may miss that there is a compilation error in your code.
To avoid these cases, me and [Emil Kashkevich](https://github.com/lysyi3m) came up with the following trick:

1. Small Webpack plugin writes all compilation errors to `tmp/webpack-status.json`. If there are no errors, the file becomes empty
2. If `tmp/webpack-status.json` is not empty, Rails will read the file and display the backtrace
3. You'll immediately see all Webpack errors right in your browser

I decided not to share the plugin here because the implementation was too dirty, but it should't take more than an hour for you to write a similar script.

# Running on Heroku

We also wanted to make Heroku automatically precompile all assets when the app is deployed. At first I tried to write a simple Heroku buildpack myself, but then I discovered that the [official Node buildpack from Heroku](https://github.com/heroku/heroku-buildpack-nodejs) perfectly works for us.

We had to configure Heroku to use [two buildpacks](https://devcenter.heroku.com/articles/using-multiple-buildpacks-for-an-app):

{% highlight bash %}
heroku buildpacks:set heroku/ruby
heroku buildpacks:add --index 1 heroku/nodejs
{% endhighlight %}

And set the NPM environment:

{% highlight bash %}
heroku config:set NODE_ENV=production NPM_CONFIG_PRODUCTION=true
{% endhighlight %}

You'll also need to have the `package.json` which it's basically a `Gemfile` for the NPM world. This file allows to set a `postinstall` callback that will run on Heroku. In our case it precompiled the assets:

{% highlight json %}
{
  "repository": "https://github.com/kirs/app.git",
  "scripts": {
    "development": "webpack --config webpack.development.js",
    "production": "webpack --config webpack.production.js",
    "postinstall": "sh -c 'if [ \"${NODE_ENV}\" = \"production\" ]; then npm run production; fi'"
  },
  "dependencies": {
     …
  }
}
{% endhighlight %}

Well done. From now on, when you push the code to Heroku, it will run NPM/Webpack scripts to precompile the assets as well as the Rails app.

<hr/>

I hope these three recipes helped you to get started with Webpack on Rails and Heroku.

Big thanks to my former colleagues at [Evil Martians](http://evl.ms) who contributed to the Webpack integration described in this post.

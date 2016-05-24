---
layout: post
title: Starting with Clojure
date: 2016-05-24
comments: true
published: true
---

It has been almost a year since I’ve started with Clojure. Thanks to [Nate](https://twitter.com/xnutsive/) who offered me to pair for learning in June 2015.

Clojure feels very expressive and simple for me after 5 years with Rails. What I really like about it is that you don’t need any framework; everything can be composed with components. Hiccup for views, Ring for HTTP stack, Korma for building SQL, couple of middlewares for parameter and Content-Type handling.

I miss this lack of building your project from components in Ruby. I’m also going to miss immutability and powerful data structures.

It’s also worth mentioning that Clojure was one of the reasons why I switched to Vim because Atom didn’t have a REPL plugin at that time.

<hr/>

Since you’re reading this post in my blog, today I’m here to announce my latest pet project in Clojure: I’ve been rewriting my blog on Jekyll to Clojure as a practice in learning the language. You can check the [source code](https://github.com/kirs/clj-blog) and [live website on Heroku](clj-blog.herokuapp.com).

I’ve implemented main features from Jekyll: markdown / [Front Matter](https://jekyllrb.com/docs/frontmatter/) parsers and code highlighting, working with published/draft posts and URLs. Of course it’s not as flexible as Jekyll and it doesn’t generate static files, but it works for my blog.

Things missing in the project:

* archive by year and month because haven’t found a perfect HTTP router yet. I’m using [Compojure](https://github.com/weavejester/compojure/) now but it doesn’t have any relevant documentation about handling request parameters.
* pagination because I couldn’t get Compojure to work with paths like `/page2` or `/page3`
* asset minification - what’s the best solution in Clojure for that?

<hr/>

As a reference to my previous project in Clojure, I’ll also mention my first project in Clojure: [cad-visa-tracking](https://github.com/kirs/cad-visa-tracking).

Canadian Visa application centre has quite long waiting times. This app helped me to track my passport as frequent as possible. The funny part is that after they introduced the CAPTCHA, I couldn’t automate form requests anymore :D

![canada](https://cloud.githubusercontent.com/assets/522155/15505459/568dac80-21cc-11e6-8897-54071263cb85.jpg)

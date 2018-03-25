---
layout: post
title: Rails 5.2 Credentials and Kubernetes
date: 2018-03-24
comments: true
published: true
---

I've been playing with the new [credentials feature](https://github.com/rails/rails/pull/30067){:target="_blank"} that comes with Rails 5.2 and it looks really cool! It lets you store encrypted credentials (aka "secrets") right in the repo, and decrypt them with the master key when you need to read it.

See this [blog post](https://www.engineyard.com/blog/rails-encrypted-credentials-on-rails-5.2){:target="_blank"} if you're curious how it's different from `secrets.yml` introduced in Rails 5.1.

The approach is very similar to Shopify's [ejson](https://github.com/Shopify/ejson){:target="_blank"}, with the difference that Rails decided not to use asymmetric encryption like ejson does.

So, how does this new credentials management works with containerized Rails apps that run in Kubernetes? **TL;DR it works surprisingly smooth.**

There's no rocket science in the setup, but I wrote this post to show how easy is the deployment of Rails 5.2 Credentials.

```bash
$ gem install --pre rails

$ rails -v
Rails 5.2.0.rc2

$ rails new secretland --skip-javascript --skip-spring --skip-coffee --skip-turbolinks --skip-action-cable

$ bin/rails credentials:edit
# opens vim with encrypted credentials

$ cat config/master.key
3bed2fdcb0261e6f48850de01a85fb5b
# master key for credentials of this app, also listed in .gitignore so it's not pushed to git
```

Now it's time to build a container. First, let's add the master key to `.dockerignore` file so it doesn't get into the container (we don't want to expose the key to container registry).

```bash
$ echo config/master.key > .dockerignore
```

Let's build the container using this [minimalistic](https://www.engineyard.com/blog/using-docker-for-rails){:target="_blank"} `Dockerfile`:

```
FROM ruby:2.5

RUN mkdir -p /app
WORKDIR /app

ENV RAILS_ENV production
ENV RAILS_SERVE_STATIC_FILES true
ENV RAILS_LOG_TO_STDOUT true

COPY Gemfile /app/
COPY Gemfile.lock /app/
RUN bundle config --global frozen 1
RUN bundle install --without development test

COPY . /app

EXPOSE 3000
CMD ["rails", "server", "-b", "0.0.0.0"]
```

```bash
$ docker build -t kirshatrov/secretland:v1 .
```

And run it with the master key as an ENV variable:

```bash
$ docker run -i -t -p 3000:3000 -e RAILS_MASTER_KEY=3bed2fdcb0261e6f48850de01a85fb5b kirshatrov/secretland:v1
```

If you create a [silly controller](https://github.com/kirs/secretland/blob/master/app/controllers/helloworld_controller.rb#L3){:target="_blank"} to (unsafely) render secrets, you would see this output:

<img src="/assets/post-images/rails-credentials/local.png" width="445" height="183" style="margin: 0 auto;" />

Don't forget to push the container to Docker registry so Kubernetes nodes could download and run it:

```bash
$ docker push kirshatrov/secretland:v1
```

Before creating any Kubernetes resources, we need to create the secret (actually it's the first time I'm using Kubernetes secrets!):

```bash
$ kubectl create secret generic secretland-secrets --from-literal=rails-master-key=3bed2fdcb0261e6f48850de01a85fb5b
secret "secretland-secrets" created

$ kubectl describe secret secretland-secrets
Name:         secretland-secrets
Namespace:    default
Labels:       <none>
Annotations:  <none>

Type:  Opaque

Data
====
rails-master-key:  32 bytes
```

And the [Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/){:target="_blank"} spec:

```yaml
apiVersion: extensions/v1beta1
kind: Deployment
metadata:
  name: secretland
  labels:
    app: secretland
spec:
  selector:
    matchLabels:
      app: secretland
  template:
    metadata:
      labels:
        app: secretland
    spec:
      containers:
      - image: kirshatrov/secretland:v1
        name: rails
        ports:
        - containerPort: 3000
        env:
          - name: RAILS_MASTER_KEY
            valueFrom:
              secretKeyRef:
                name: secretland-secrets
                key: rails-master-key
```

Here's the trick: we set the ENV variable (`RAILS_MASTER_KEY`) from the value of the secret that we've created earlier. This allows us to separate secrets from Deployments, and avoid leaking the master key to the Deployment resource. We could even push the YAML with Deployment spec to the application repo.

Let's apply the Deployment and expose it to the internet:

```bash
$ kubectl apply -f deployment.yml

$ kubectl expose deployment secretland --type=LoadBalancer --port=80 --target-port=3000
```

All works!

<img src="/assets/post-images/rails-credentials/prod.png" width="459" height="192" style="margin: 0 auto;" />


Code mentioned in the post is also available as a [repo](https://github.com/kirs/secretland){:target="_blank"}.

To be honest, I haven't expected that all these things would work so smoothly together! Credentials management in Rails 5.2 works very nicely with containerized applications, and took only a one command to push secrets to Kubernetes.

Next time I want to edit the credentials, `bin/rails credentials:edit` and `git push` would be enough to update them on production.

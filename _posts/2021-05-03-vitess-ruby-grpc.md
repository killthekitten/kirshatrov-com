---
layout: post
title: "Talking to Vitess over GRPC from Ruby"
date: 2021-05-02
comments: true
published: true
---

After you've got to run a simple Vitess cluster with a few databases, you might want to automate some of the stuff, for instance if you're doing lots of [resharding](https://vitess.io/docs/reference/vreplication/reshard/){:target="\_blank"} or [vertical splits](https://vitess.io/docs/user-guides/migration/move-tables/){:target="\_blank"}.

How do you **script** interactions with Vitess? You could have a Bash script do all the `vtctlclient` work, but at some point that would become fragile.

Vitess provides world-class Go APIs, but for something that I wanted to experiment with, Ruby was be a better fit.

In this post I wanted to share how I got to **talk to Vitess through GRPC from Ruby**.

## GRPC adventures

GRPC relies on code generating. That's a bit unusual if you come from the Ruby ecosystem but nevertheless.

You have to install the `grpc-tools` gem that ships codegenerating tools.

Once you have it installed you should be able to run something like:

```
$ grpc_tools_ruby_protoc -I /Users/kirs/src/github.com/vitessio/vitess/proto --ruby_out=lib --grpc_out=lib /Users/kirs/src/github.com/vitessio/vitess/proto/*.proto
```

Yes &ndash; you're supposed to have the Vitess repo cloned (in my case, to `/Users/kirs/src/github.com/vitessio/vitess`) to generate Ruby classes based on protobuf definitions that live in the `proto/` dir in the Vitess repo. `--ruby_out=lib --grpc_out=lib` tells it to output generated Ruby code into `lib/` of your local project.

After generating the code from protobufs your `lib`/ would look like this:

```
tree lib
lib
├── automation_pb.rb
├── automationservice_pb.rb
├── automationservice_services_pb.rb
├── binlogdata_pb.rb
├── binlogservice_pb.rb
...
├── vtrpc_pb.rb
├── vttest_pb.rb
├── vttime_pb.rb
├── vtworkerdata_pb.rb
├── vtworkerservice_pb.rb
├── vtworkerservice_services_pb.rb
└── workflow_pb.rb
```

Now you have enough code to call GRPC commands on Vitess.

## Two ways

Let's imagine you want to call the `VReplicationExec` RPC. There's at least two ways to do that.

One way would be to talk to _vtctld_, the top level topology service.

```ruby
require 'vtctlservice_pb'
require 'vtctlservice_services_pb'

service = Vtctlservice::Vtctl::Stub.new('<address-of-vtctld>:15999', :this_channel_is_insecure)
tablet_name = "zone1-0428408676"
response = service.execute_vtctl_command(
  ::Vtctldata::ExecuteVtctlCommandRequest.new(
    args: ["VReplicationExec", "-json", tablet_name, "select id from _vt.vreplication"]
  )
)
response.each do |r|
  pp JSON.parse(r.event.value)
end
```

You can see that `execute_vtctl_command` in a generic RPC call that takes a name of another RPC (`VReplicationExec`) as the first argument, following the actual arguments. And at the end you have to parse result as JSON.

**Another way** that involves less manual actions is sending RPC to the actual _vttablet address_.

```ruby
require 'tabletmanagerdata_pb'
require 'tabletmanagerservice_services_pb'

s = Tabletmanagerservice::TabletManager::Stub.new('<address-of-vttablet>:15999', :this_channel_is_insecure)
s.v_replication_exec(Tabletmanagerdata::VReplicationExecRequest.new(query: "select id from _vt.vreplication"))
# => <Tabletmanagerdata::VReplicationExecResponse: result: <Query::QueryResult: fields: [<Query::Field: name: "id", type: :INT32, table: "vreplication", org_table: "vreplication", database: "_vt", org_name: "id", column_length: 11, charset: 63, decimals: 0, flags: 49667, column_type: "">], rows_affected: 0, insert_id: 0, rows: []>>
```

You can notice that the response comes already parsed.

What took me a while to understand is that I have to be mindful about the GRPC endpoint address. It's easy to send an RPC that's meant for vttablet to vtctld instead, and get error message like `unknown service vtctlservice.Vtctl`.

I found myself looking at `*.proto` files, then referencing them to the generated Ruby code, then trying stuff in IRB session.

Working with GRPC in Ruby is not ideal and feels unusual, but that's the price to pay for strictly typed remote procedure calls that has its benefits.

Enjoy your hacking with Vitess from Ruby.

var nad = nad || {};

nad.bindKeys = function(ctrl) {
  _.each(nad.keyBindings, function (kb) {
    Mousetrap.bind(kb.key, ctrl[kb.callback]);
  });
};

nad.keyBindings = [
  {key: 'p', callback: 'power', description: 'Toggle power'},
  {key: 'm', callback: 'mute', description: 'Toggle mute'},
  {key: 's', callback: 'speakerA', description: 'Toggle headphones'},
  {key: 'i', callback: 'amp', description: 'Get amplifier model'},
  {key: '+', callback: 'volumeUp', description: 'Increase volume'},
  {key: '-', callback: 'volumeDown', description: 'Decrease volume'},
  {key: 'h', callback: 'showHelp',
   description: 'Togge list of keyboard shortcuts'}
];

nad.initState = function(ctrl) {
  nad.get(ctrl, 'Power');
  nad.get(ctrl, 'Mute');
  nad.get(ctrl, 'Source');
  nad.get(ctrl, 'SpeakerA');
};

nad.fmtCmd = function(data) {
  return 'Main.' + [data.Variable, data.Value].join(data.Operator);
};

nad.fromValue = function(v) {
  return v === 'On' || v === 'Off' ? v === 'On' : v;
};

nad.toValue = function(v) {
  if (_.isBoolean(v)) {
    return v ? 'On' : 'Off';
  }
  return v;
};

nad.get = function(ctrl, variable) {
  m.request({method: 'GET', url: '/api/v1/nad/state/' + variable})
    .then(function (data) {
      var state = ctrl.model().state;
      state[data.Variable] = nad.fromValue(data.Value);
      ctrl.model({state: state});
    }, ctrl.error);
};

nad.send = function(ctrl, req) {
  req.Value = nad.toValue(req.Value);
  m.request({method: 'POST', url: '/api/v1/nad', data: req})
    .then(function (data) {
      var state = ctrl.model().state;
      state[data.Variable] = nad.fromValue(data.Value);
      ctrl.error({});
      ctrl.model({
        message: {request: req, reply: data},
        state: state,
      });
    }, ctrl.error);
};

nad.controller = function() {
  var ctrl = this;
  ctrl.error = m.prop({});
  ctrl.model = m.prop({
    state: {Power: false, Mute: false, SpeakerA: true},
    message: {}
  });
  ctrl.helpVisible = m.prop(false);
  ctrl.power = function() {
    nad.send(ctrl, {
      Variable: 'Power',
      Operator: '=',
      Value: !ctrl.model().state.Power
    });
  };
  ctrl.mute = function() {
    nad.send(ctrl, {
      Variable: 'Mute',
      Operator: '=',
      Value: !ctrl.model().state.Mute
    });
  };
  ctrl.volumeUp = function() {
    nad.send(ctrl, {
      Variable: 'Volume',
      Operator: '+',
    });
  };
  ctrl.volumeDown = function() {
    nad.send(ctrl, {
      Variable: 'Volume',
      Operator: '-',
    });
  };
  ctrl.source = function(value) {
    nad.send(ctrl, {
      Variable: 'Source',
      Operator: '=',
      Value: value
    });
  };
  ctrl.amp = function() {
    nad.send(ctrl, {
      Variable: 'Model',
      Operator: '?'
    });
  };
  ctrl.speakerA = function() {
    nad.send(ctrl, {
      Variable: 'SpeakerA',
      Operator: '=',
      Value: !ctrl.model().state.SpeakerA
    });
  };
  ctrl.showHelp = function() {
    var visible = ctrl.helpVisible();
    m.startComputation();
    ctrl.helpVisible(!visible);
    m.endComputation();
  };
  nad.bindKeys(ctrl);
  nad.initState(ctrl);
};

nad.console = function(ctrl) {
  var text;
  if (_.isEmpty(ctrl.model().message)) {
    text = ['These go to eleven!'];
  } else {
    text = ['sent:     ' + nad.fmtCmd(ctrl.model().message.request),
            'received: ' + nad.fmtCmd(ctrl.model().message.reply)];
  }
  return m('pre.console', text.join('\n'));
};

nad.onoff = function(ctrl, options) {
  var state = ctrl.model().state;
  if (!_.has(state, options.type)) {
    throw 'Unknown type: ' + options.type;
  }
  var isOn = state[options.type];
  var active = options.invert ? !isOn : isOn;
  return m('button[type=button]', {
    class: 'btn btn-default btn-lg' + (active ? ' active' : ''),
    onclick: options.onclick
  }, options.icon);
};

nad.volume = function(ctrl, options) {
  return m('button[type=button]', {
    class: 'btn btn-default btn-lg',
    onclick: options.onclick
  }, options.icon);
};

nad.source = function(ctrl) {
  var sources = ['CD', 'Tuner', 'Video', 'Disc/MDC', 'Tape2', 'Aux'];
  var model = ctrl.model();
  return m('select.form-control', {
    onchange: m.withAttr('value', ctrl.source)
  }, _.map(sources, function(src) {
    var val = src.toUpperCase();
    var selected = model.state.Source === val ? 'selected' : '';
    return m('option', {value: val, selected: selected}, src);
  }));
};

nad.amp = function(ctrl, options) {
  return m('button[type=button]', {
    class: 'btn btn-default btn-lg',
    onclick: ctrl.amp
  }, options.icon);
};

nad.error = function(ctrl) {
  var e = ctrl.error();
  var isError = !_.isEmpty(e);
  var text = isError ? e.message + ' (' + e.status + ')' : '';
  var cls = 'alert-danger' + (isError ? '' : ' hidden');
  return m('div.alert', {class: cls, role: 'alert'}, [
    m('strong', 'Error! '), text
  ]);
};

nad.help = function(ctrl) {
  if (!ctrl.helpVisible()) {
    return m('p.text-muted', 'Tip: Press ', m('code', 'h'),
             ' to display keyboard shortcuts');
  }
  var rows = _.map(nad.keyBindings, function (kb) {
    return m('tr', [
      m('td', m('center', m('code', kb.key))),
      m('td', kb.description)
    ]);
  });
  return m('table.table',
           m('thead', m('tr', [
             m('th', 'Key binding'),
             m('th', 'Description')
           ])),
           m('tbody', rows)
          );
};

nad.view = function(ctrl) {
  return m('div.container', [
    m('div.row', [
      m('div.col-md-4', m('h1', [
        m('span', {class: 'glyphicon glyphicon-signal'}), ' amp remote'
      ]))
    ]),
    m('div.row', [
      m('div.col-md-4', nad.error(ctrl))
    ]),
    m('div.row', [
      m('div.col-md-4', [
        nad.console(ctrl)
      ])
    ]),
    m('div.row', [
      m('div.col-md-2', {class: 'top-spacing'}, [
        nad.onoff(ctrl, {
          onclick: ctrl.power,
          type: 'Power',
          icon: m('span', {class: 'glyphicon glyphicon-off'})
        })
      ]),
      m('div.col-md-2', {class: 'top-spacing'}, [
        nad.onoff(ctrl, {
          onclick: ctrl.mute,
          type: 'Mute',
          icon: m('span', {class: 'glyphicon glyphicon-volume-off'})
        })
      ])
    ]),
    m('div.row', [
      m('div.col-md-2', {class: 'top-spacing'}, [
        nad.volume(ctrl, {
          onclick: ctrl.volumeUp,
          icon: m('span', {class: 'glyphicon glyphicon-volume-up'})
        })
      ]),
      m('div.col-md-2', {class: 'top-spacing'}, [
        nad.volume(ctrl, {
          onclick: ctrl.volumeDown,
          icon: m('span', {class: 'glyphicon glyphicon-volume-down'})
        })
      ])
    ]),
    m('div.row', [
      m('div.col-md-2', {class: 'top-spacing'}, [
        nad.onoff(ctrl, {
          onclick: ctrl.speakerA,
          type: 'SpeakerA',
          icon: m('span', {class: 'glyphicon glyphicon-headphones'}),
          invert: true
        })
      ]),
      m('div.col-md-2', {class: 'top-spacing'}, [
        nad.amp(ctrl, {
          icon: m('span', {class: 'glyphicon glyphicon-info-sign'})
        })
      ])
    ]),
    m('div.row', [
      m('div.col-md-4', {class: 'top-spacing'}, nad.source(ctrl))
    ]),
    m('div.row', m('div.col-md-4', {class: 'top-spacing'}, nad.help(ctrl)))
  ]);
};

m.mount(document.getElementById('nad-remote'), nad);

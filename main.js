'use strict';
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const adapter = utils.Adapter('meter-sockets');
const schedule = require('node-schedule');


/*
 * internal libraries
 */
const Library = require(__dirname + '/lib/library.js');


/*
 * variables initiation
 */
var library = new Library(adapter);
var schedules = [];
var nodes = [
	{'node': 'device', 'description': 'Device name', 'role': 'text'},
	{'node': 'jobs', 'description': 'Completed jobs', 'role': 'list'},
	{'node': '_running', 'description': 'Boolean if event is currently running', 'role': 'state', 'type': 'boolean'},
	{'node': 'state', 'description': 'State of device to meter', 'role': 'text'},
	{'node': 'enabled', 'description': 'Boolean if device metering is enabled', 'role': 'state', 'type': 'boolean'},
	
	{'node': 'job', 'description': 'Status of current job run', 'type': 'channel'},
	{'node': 'job.started', 'description': 'Timestamp the current event has started', 'role': 'value'},
	{'node': 'job.startedDateTime', 'description': 'Datetime the current event has started', 'role': 'text'},
	{'node': 'job.finished', 'description': 'Timestamp the last event has finished', 'role': 'value'},
	{'node': 'job.finishedDateTime', 'description': 'Datetime the last event has finished', 'role': 'text'},
	{'node': 'job.threshold', 'description': 'Defined threshold of device', 'role': 'value.power.consumption', 'common': {'unit': 'Wh'}},
	{'node': 'job.usage', 'description': 'Total usage of current job', 'role': 'value.power.consumption', 'common': {'unit': 'kWh'}},
	
	{'node': 'usage', 'description': 'Usage statistics of device', 'type': 'channel'},
	{'node': 'usage._average', 'description': 'Current average usage', 'role': 'value.power.consumption', 'common': {'unit': 'Wh'}},
	{'node': 'usage.yearly', 'description': 'Usage in current year', 'role': 'value.power.consumption', 'common': {'unit': 'kWh'}},
	{'node': 'usage.quartely', 'description': 'Usage in current quarter', 'role': 'value.power.consumption', 'common': {'unit': 'kWh'}},
	{'node': 'usage.monthly', 'description': 'Usage in current month', 'role': 'value.power.consumption', 'common': {'unit': 'kWh'}},
	{'node': 'usage.daily', 'description': 'Usage in current day', 'role': 'value.power.consumption', 'common': {'unit': 'kWh'}},
	{'node': 'costs', 'description': 'Cost statistics of device', 'type': 'channel'},
];


/*
 * ADAPTER UNLOAD
 *
 */
adapter.on('unload', function(callback)
{
    try
	{
		schedules.forEach(function(schedule) {schedule.cancel()});
        adapter.log.info('Adapter stopped und unloaded.');
        callback();
    }
	catch(e)
	{
        callback();
    }
});


/*
 * ADAPTER READY
 *
 */
adapter.on('ready', function()
{
	// verify devices are defined
	if (adapter.config.devices === undefined || adapter.config.devices.length === 0)
	{
		adapter.log.warn('No devices to monitor have been entered. Go to configuration and enter devices.');
		return;
	}
	
	// subscribe to devices
	var devices = [];
	adapter.config.devices.forEach(function(device, i)
	{
		device.id = i;
		adapter.getForeignState(device.state, function(err, state)
		{
			if (device.state === '' || err !== null || state === null)
				adapter.log.warn(device.state === '' ? 'State of device ' + device.name + ' not set!' : 'State (' + device.state + ') of device ' + device.name + ' not found!');
			
			else
				devices.push(createDevice(device)); // be aware that this is asynchronous
		});
	});
	
	// update states
	schedules.push(schedule.scheduleJob('0 * * * * *', function(date) // second, minute, hour, day of month, month, day of week
	{
		//adapter.log.silly('Writing power data to history states.');
		
		devices.forEach(function(device)
		{
			// write average value
			var total, current = 0;
			adapter.getState(device.id + '.usage._average', function(err, avg)
			{
				current = parseFloat((avg.val/1000).toFixed(3));
				
				// get date values
				var year = date.getFullYear();
				var quarter = '0' + Math.floor((date.getMonth()+3)/3);
				var month = ('0' + (date.getMonth()+1)).substr(-2);
				var day = ('0' + date.getDate()).substr(-2);
				
				// define states
				var usage = ['daily', 'monthly', 'quartely', 'yearly'].map(function(i) {return '.usage.' + i});
				var history = [year + '.total', year + '.Q' + quarter, year + '.' + month + '.total', year + '.' + month + '.' + day + '.total'].map(function(i) {return '.usage.history.' + i});
				
				// reset current values
				var dates = {daily: day, monthly: month, quartely: quarter, yearly: year};
				usage.forEach(function(state)
				{
					var node = device.id + state;
					adapter.getObject(node, function(err, obj)
					{
						var scope = obj.common !== undefined && obj.common.scope !== undefined ? obj.common.scope: 0;
						var index = state.substr(state.lastIndexOf('.')+1);
						
						if (scope != dates[index])
						{
							adapter.log.debug('Resetted ' + index + ' (' + node + ').');
							adapter.extendObject(node, {common: {scope: dates[index]}});
							adapter.setState(node, 0);
						}
					});
				});
				
				// write value to current & history
				['.job.usage'].concat(usage, history).forEach(function(state)
				{
					var node = device.id + state;
					adapter.getState(node, function(err, value)
					{
						total = parseFloat(value.val.toFixed(3)) + current;
						adapter.log.silly('Writing power usage of device ' + device.name + ' (+' + current + ' = ' + total + ') to history state -' + state + '-.');
						
						library.set(
							{node: node, description: state, 'role': 'value.power.consumption', 'common': {'unit': 'kWh'}},
							total
						);
					});
				});
				
				
			});
		});
	}));
	
	// meter devices
	schedules.push(schedule.scheduleJob('*/10 * * * * *', function()
	{
		library.set({node: '_devices', description: 'List of devices', 'role': 'list'}, JSON.stringify(devices));
		devices.forEach(function(device) {meter(device)});
	}));
});


/**
 * Metering device
 *
 *
 */
function meter(device, settings)
{
	settings = settings !== undefined ? settings : {};
	var max = settings.max || 6;
	var average = 0;
	
	var running, metered, average;
	adapter.getForeignState(device.state, function(err, payload)
	{
		// error
		if (err) return;
		
		// get power value
		var value = Math.floor(payload.val*100)/100;
		adapter.log.silly('Device ' + device.name + ' (' + device.state + ') reports usage of ' + value + '.');
		
		// set data
		library._setValue(device.id + '.device', device.name);
		library._setValue(device.id + '.state', device.state);
		library._setValue(device.id + '.enabled', device.active);
		library._setValue(device.id + '.job.threshold', device.threshold);
		
		// skip if device is disabled
		if (device.active !== true) return;
		
		// get current status
		adapter.getState(device.id + '._running', function(err, status)
		{
			// error
			if (err || !status) return;
			
			// set status
			running = !!status.val;
			library._setValue(device.id + '._running', running);
			
			// get metered data
			adapter.getObject(device.id + '.usage._average', function(err, obj)
			{
				// get metered data
				metered = obj.common.metered !== undefined ? JSON.parse(obj.common.metered) : [];
				
				// modify metered data and save
				metered.push(value);
				if (metered.length > max) metered.shift(); 
				adapter.extendObject(device.id + '.usage._average', {common: {metered: JSON.stringify(metered)}});
				
				// get average
				average = getAverage(metered);
				library._setValue(device.id + '.usage._average', average);
				
				// set device running
				if (running === false && average > device.threshold)
				{
					adapter.log.info('Device ' + device.name + ' has been detected started.');
					library._setValue(device.id + '._running', true);
					library._setValue(device.id + '.job.started', Math.round(Date.now()/1000));
					library._setValue(device.id + '.job.startedDateTime', library.getDateTime(Date.now()));
					
					library._setValue(device.id + '.job.finished', 0);
					library._setValue(device.id + '.job.finishedDateTime', '');
					
					// voice output
					if (device.alexa !== undefined && device.alexa !== '' && adapter.config.alexaStarted !== '')
						adapter.setForeignState('alexa2.0.Echo-Devices.' + device.alexa + '.Commands.speak', adapter.config.alexaStarted.replace(/%device%/gi, device.name));
					
					// message output
					if (device.telegram !== undefined && device.telegram !== '' && adapter.config.telegramStarted !== '')
					{
						var config = {
							text: adapter.config.telegramStarted.replace(/%device%/gi, device.name),
							//parse_mode: 'HTML'
						};
						
						adapter.sendTo('telegram.0', device.telegram !== 'ALL' ? Object.assign({user: device.telegram}, config) : config);
					}
				}
				
				// set device finished
				else if (running === true && average <= device.threshold)
				{
					adapter.log.info('Device ' + device.name + ' has been detected finished.');
					var endTime = Date.now();
					
					library._setValue(device.id + '._running', false);
					library._setValue(device.id + '.job.finished', Math.round(endTime/1000));
					library._setValue(device.id + '.job.finishedDateTime', library.getDateTime(endTime));
					adapter.extendObject(device.id + '.usage._average', {common: {metered: JSON.stringify([])}});
					
					// voice output
					if (device.alexa !== undefined && device.alexa !== '' && adapter.config.alexaFinished !== '')
						adapter.setForeignState('alexa2.0.Echo-Devices.' + device.alexa + '.Commands.speak', adapter.config.alexaFinished.replace(/%device%/gi, device.name));
					
					// message output
					if (device.telegram !== undefined && device.telegram !== '' && adapter.config.telegramFinished !== '')
					{
						var config = {
							text: adapter.config.telegramFinished.replace(/%device%/gi, device.name),
							//parse_mode: 'HTML'
						};
						
						adapter.sendTo('telegram.0', device.telegram !== 'ALL' ? Object.assign({user: device.telegram}, config) : config);
					}
					
					// save job & send out notifications
					var jobs = "";
					adapter.getState(device.id + '.jobs', function(err, obj)
					{
						// log job to history
						jobs = JSON.parse(obj.val || '[]');
						adapter.getState(device.id + '.job.usage', function(err, obj)
						{
							var total = obj.val || 0;
							library._setValue(device.id + '.job.usage', 0);
							
							adapter.getState(device.id + '.job.started', function(err, obj)
							{
								var startTime = obj.val || 0;
								jobs.push({
									'total': total,
									'runtime': Math.round(endTime/1000)-startTime,
									'started': startTime,
									'startedDateTime': library.getDateTime(startTime*1000),
									'finished': Math.round(endTime/1000),
									'finishedDateTime': library.getDateTime(endTime),
								});
								
								library._setValue(device.id + '.jobs', JSON.stringify(jobs));
							});
						});
					});
				}
			});
		});
	});
}


/**
 * Creates a device
 *
 * @param	{object}	device		Device to be added
 * @return	void
 *
 */
function createDevice(device)
{
	// check if device is already created
	device.id = device.id === undefined ? device.name.toLowerCase().replace(/ /g, '_') : device.id.toString();
	adapter.getObject(device.id, function(err, obj)
	{
		// device not created, so create states
		if (err !== null || obj === null)
		{
			adapter.createDevice(device.id, {name: 'Device ' + device.name}, {}, function()
			{
				// create states
				nodes.forEach(function(node)
				{
					library.set(Object.assign({}, node, {node: device.id + '.' + node.node}), node.role === 'value.power.consumption' ? 0 : '');
				});
				
				// write log
				adapter.log.info('Registered device ' + device.name + ' (' + device.state + ').');
				
				// extend monitored state
				adapter.extendForeignObject(device.state, {common: {'meter-sockets': device}});
			});
		}
		
		// device already created, so change name
		else
			adapter.extendObject(device.id, {common: {name: 'Device ' + device.name}});
	});
	
	return device;
}


/**
 * Calculates an average.
 * 
 * @param   {array}     numbers     Array of numbers the average is calculated by
 * @return	{float}                 Returns the calculated average
 * 
 */
function getAverage(numbers)
{
    var total = 0;
    numbers = numbers.filter(Boolean);
    numbers.forEach(function(number) {total -= parseInt(number)});
    return total === 0 ? 0 : Math.round((-1*total) / numbers.length, 2);
}
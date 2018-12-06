'use strict';
const utils = require(__dirname + '/lib/utils'); // Get common adapter utils
const adapter = utils.Adapter('meter-sockets');


/*
 * internal libraries
 */
const Library = require(__dirname + '/library.js');


/*
 * variables initiation
 */
var library = new Library(adapter);
var nodes = [
	{'node': 'device', 'description': 'Device name', 'role': 'text'},
	{'node': 'jobs', 'description': 'Completed jobs', 'role': 'list'},
	{'node': '_running', 'description': 'Boolean if event is currently running', 'role': 'state', 'type': 'boolean'},
	{'node': 'state', 'description': 'State of device to meter', 'role': 'text'},
	{'node': 'enabled', 'description': 'Boolean if device metering is enabled', 'role': 'state', 'type': 'boolean'},
	{'node': 'status.started', 'description': 'Timestamp the current event has started', 'role': 'value'},
	{'node': 'status.startedDateTime', 'description': 'Datetime the current event has started', 'role': 'text'},
	{'node': 'status.finished', 'description': 'Timestamp the last event has finished', 'role': 'value'},
	{'node': 'status.finishedDateTime', 'description': 'Datetime the last event has finished', 'role': 'text'},
	{'node': 'status.average', 'description': 'Current average usage', 'role': 'value'},
	{'node': 'status.total', 'description': 'Total consumption on current run', 'role': 'value'},
	{'node': 'status.threshold', 'description': 'Defined threshold of device', 'role': 'value'},
];


/*
 * ADAPTER UNLOAD
 *
 */
adapter.on('unload', function(callback)
{
    try
	{
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
		if (device.state !== '')
		{
			device.id = i;
			devices.push(createDevice(device));
			adapter.subscribeForeignStates(device.state);
		}
	});
	
	// list devices
	library.set({node: '_devices', description: 'List of devices', 'role': 'list'}, JSON.stringify(devices));
});

/*
 * STATE CHANGE
 *
 */
adapter.on('stateChange', function(state, payload)
{
	//adapter.log.debug('Changed state of ' + state + ': ' + JSON.stringify(payload));
	
	var value = Math.floor(payload.val*100)/100;
	var average = 0;
	var max = 12;
	
	var device, running, metered, average;
	adapter.getForeignObject(state, function(err, obj)
	{
		// error
		if (err) return;
		
		// get device
		device = obj.common['meter-sockets'];
		
		// skip if device is disabled
		if (device.active !== true) return;
		
		// get current status
		adapter.getState(device.id + '._running', function(err, status)
		{
			// error
			if (err || !status) return;
			
			// set data
			library._setValue(device.id + '.device', device.name);
			library._setValue(device.id + '.state', device.state);
			library._setValue(device.id + '.enabled', device.active);
			
			// set status
			running = !!status.val;
			library._setValue(device.id + '._running', running);
			
			// get metered data
			adapter.getObject(device.id + '.status.average', function(err, obj)
			{
				// get metered data
				metered = obj.common.metered !== undefined ? JSON.parse(obj.common.metered) : [];
				
				// modify metered data and save
				metered.push(value);
				if (metered.length > max) metered.shift(); 
				adapter.extendObject(device.id + '.status.average', {common: {metered: JSON.stringify(metered)}});
				library._setValue(device.id + '.status.threshold', device.threshold);
				
				// get average
				average = getAverage(metered);
				library._setValue(device.id + '.status.average', average);
				
				// add up total
				adapter.getState(device.id + '.status.total', function(err, obj) {library._setValue(device.id + '.status.total', obj !== undefined ? parseInt(obj.val)+value : 0)});
				
				// set device running
				if (running === false && average > device.threshold)
				{
					adapter.log.info('Device ' + device.name + ' has been detected started.');
					library._setValue(device.id + '._running', true);
					library._setValue(device.id + '.status.started', Math.round(Date.now()/1000));
					library._setValue(device.id + '.status.startedDateTime', library.getDateTime(Date.now()));
					
					library._setValue(device.id + '.status.finished', 0);
					library._setValue(device.id + '.status.finishedDateTime', '');
					
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
					library._setValue(device.id + '.status.finished', Math.round(endTime/1000));
					library._setValue(device.id + '.status.finishedDateTime', library.getDateTime(endTime));
					adapter.extendObject(device.id + '.status.average', {common: {metered: JSON.stringify([])}});
					
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
						adapter.getState(device.id + '.status.total', function(err, obj)
						{
							var total = obj.val || 0;
							adapter.getState(device.id + '.status.started', function(err, obj)
							{
								var startTime = obj.val || 0;
								jobs.push({
									'total': total,
									'runtime': startTime-Math.round(endTime/1000),
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
});


/**
 * Creates a device
 *
 * @param	{object}	device	Device to be added
 * @return	void
 *
 */
function createDevice(device)
{
	// create states
	device.id = device.id === undefined ? device.name.toLowerCase().replace(/ /g, '_') : device.id.toString();
	adapter.createDevice(device.id, {}, {}, function()
	{
		// create state
		nodes.forEach(function(node)
		{
			library.set({node: device.id + '.' + node.node, description: node.description, role: node.role, type: node.type}, '');
		});
		
		// change name
		adapter.extendObject(device.id, {common: {name: 'Device ' + device.name}});
		
		
		// write log
		adapter.log.info('Created device ' + device.name + ' (' + device.state + ').');
		
		// extend monitored state
		adapter.extendForeignObject(device.state, {common: {'meter-sockets': device}});
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
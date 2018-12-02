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
	{'node': 'running', 'description': 'Boolean if event is currently running', 'role': 'state', 'type': 'boolean'},
	{'node': 'started', 'description': 'Timestamp the current event has started', 'role': 'value'},
	{'node': 'startedDateTime', 'description': 'Datetime the current event has started', 'role': 'text'},
	{'node': 'finished', 'description': 'Timestamp the last event has finished', 'role': 'value'},
	{'node': 'finishedDateTime', 'description': 'Datetime the last event has finished', 'role': 'text'},
	{'node': 'average', 'description': 'Current average usage', 'role': 'value'},
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
	adapter.log.debug(JSON.stringify(adapter.config.devices));
	
	adapter.config.devices.forEach(function(device)
	{
		if (device.state !== '')
		{
			createDevice(device);
			adapter.subscribeForeignStates(device.state);
		}
	});
});

/*
 * STATE CHANGE
 *
 */
adapter.on('stateChange', function(state, payload)
{
	var value = Math.floor(payload.val);
	var average = 0;
	var max = 12;
	
	var device, running, metered, average;
	adapter.getForeignObject(state, function(err, obj)
	{
		if (err)
			return;
		
		// get device
		device = obj.common['meter-sockets'];
		
		// skip if device is disabled
		if (device.active !== true)
			return;
		
		// get current status
		adapter.getState(device.id + '.running', function(err, status)
		{
			// set states
			running = !!status.val;
			library._setValue(device.id + '.device', device.name);
			library._setValue(device.id + '.running', running);
			
			// get metered data
			adapter.getObject(device.id + '.average', function(err, obj)
			{
				// get metered data
				metered = obj.common.metered !== undefined ? JSON.parse(obj.common.metered) : [];
				
				// modify metered data and save
				metered.push(value);
				if (metered.length > max) metered.shift(); 
				adapter.extendObject(device.id + '.average', {common: {metered: JSON.stringify(metered)}});
				
				// get average
				average = getAverage(metered);
				library._setValue(device.id + '.average', average);
				
				// set device running
				if (running === false && average > device.threshold)
				{
					adapter.log.info('Device ' + device.name + ' has been detected started.');
					library._setValue(device.id + '.running', true);
					library._setValue(device.id + '.started', Math.round(Date.now()/1000));
					library._setValue(device.id + '.startedDateTime', library.getDateTime(Date.now()));
					
					library._setValue(device.id + '.finished', 0);
					library._setValue(device.id + '.finishedDateTime', '');
				}
				
				// set device finished
				else if (running === true && average <= device.threshold)
				{
					adapter.log.info('Device ' + device.name + ' has been detected finished.');
					library._setValue(device.id + '.running', false);
					library._setValue(device.id + '.finished', Math.round(Date.now()/1000));
					library._setValue(device.id + '.finishedDateTime', library.getDateTime(Date.now()));
					adapter.extendObject(device.id + '.average', {common: {metered: JSON.stringify([])}});
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
	device.id = device.name.toLowerCase().replace(/ /g, '_');
	adapter.createDevice(device.id, {name: 'Device ' + device.name}, {}, function()
	{
		nodes.forEach(function(node)
		{
			library.set({node: device.id + '.' + node.node, description: node.description, role: node.role, type: node.type}, '');
		});
	});
	
	// extend monitored state
	adapter.extendForeignObject(device.state, {common: {'meter-sockets': device}});
	
	// write log
	adapter.log.info('Created device ' + device.name + ' (' + device.state + ').');
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
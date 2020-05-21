const got = require('got');
const twilio = require('twilio');

const config = require('./config.json');

const twilioClient = twilio(config.twilio.account_sid, config.twilio.auth_token);
const offlineData = {};
let interval = 2 * 60;
if (config.check_interval_in_seconds && config.check_interval_in_seconds > 0) {
  interval = Number(config.check_interval_in_seconds);
}

/* 
 * TODO:
 * Check if server that runs this tool has internet conneciton by itself
 * If not, don't notify, or maybe notify with different notice (configurable)
 */

const runChecks = () => {
  setTimeout(() => {
    runChecks();
  }, interval * 1000);

  config.urls.forEach((url) => {
    checkUrl(url);
  });
};

const checkUrl = async (url) => {
  let online = true;

  if (offlineData[url] && offlineData[url].timestamp_last_retry) {
    if (new Date().valueOf() < (offlineData[url].timestamp_last_retry + (config.retry_after_offline_interval_in_seconds * 1000))) {
      // Skip this check because we know it's offline, and the retry_after_offline_interval_in_seconds hasn't passed yet
      return;
    }
  }

  if (offlineData[url] && offlineData[url].timestamp_last_retry) {
    offlineData[url].timestamp_last_retry = new Date().valueOf();
  }

  try {
    await got(url, {
      timeout: config.url_timeout_ms || 500,
      retry: 0
    });
  } catch (e) {
    let error = e.code;
    if (e.name === 'HTTPError') {
      // If response statusCode does not start with a 5, we continue as valid response
      if (String(e.response.statusCode).startsWith('5') === false) {
        return;
      }
      error = e.response.statusCode;
    }

    online = false;

    if (!offlineData[url]) {
      offlineData[url] = {
        counter: 0
      };
    }
    if (offlineData[url] && offlineData[url].counter === 0) {
      offlineData[url].offline_since = new Date();
    }
    offlineData[url].counter++;

    if (offlineData[url].timestamp_last_retry) {
      console.log(new Date(), 'site still OFFLINE:', url, 'Error:', error, 'detection #' + offlineData[url].counter, 'offline since:', offlineData[url].offline_since);
    } else {
      console.log(new Date(), 'site POSSIBLE OFFLINE:', url, 'Error:', error, 'detection #' + offlineData[url].counter);
    }

    if (offlineData[url].counter >= Number(config.notify_treshold || 5) && offlineData[url].notified !== true) {
      offlineData[url].notified = true;
      offlineData[url].timestamp_last_retry = new Date().valueOf();
      notifySMS('SERVER OFFLINE!\nServer: ' + url + '\nError: ' + error + '\nSince: ' + offlineData[url].offline_since + '\nCurrent time:', new Date());
      if (config.call_notification === true) {
        notifyCall();
      }
      console.log('\n\n\n/!\\ Site (' + url + ') reached the offline notify treshold. Current offline state: ' + offlineData[url].counter, '\n\n');
    }
  } finally {
    if (online === true) {
      if (offlineData[url] && offlineData[url].counter > Number(config.notify_treshold || 5)) {
        notifySMS('Server back online!\nServer: ' + url + '\nOffline since: ' + offlineData[url].offline_since + '\nCurrent time:', new Date());
        console.log(new Date(), 'site ONLINE after ' + offlineData[url].counter + ' offline detections. Site was offline since:', offlineData[url].offline_since);
      }
      if (offlineData[url]) {
        offlineData[url].counter = 0;
        offlineData[url].offline_since = 0;
        offlineData[url].timestamp_last_retry = 0;
      }
    }
  }
};

const notifySMS = async (message) => {
  let response = null;
  try {
    response = await twilioClient.messages.create({
      body: message,
      from: config.twilio.from,
      to: config.twilio.to
    });
  } catch (e) {
    console.log('Error while sending text:', e);
  }
};

const notifyCall = async () => {
  let response = null;
  try {
    response = await twilioClient.calls.create({
      twiml: '<Response><Say>Your server seems to be offline, please check your text message for more details</Say></Response>',
      from: config.twilio.from,
      to: config.twilio.to
    });
  } catch (e) {
    console.log('Error while calling:', e);
  }
};

runChecks();
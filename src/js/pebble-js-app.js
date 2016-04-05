var fix = 0;
var hasTimeline = 1;
var topic = "not_set";
var defaultId = 99;

function fetchCgmData(id) {
   var options = JSON.parse(window.localStorage.getItem('cgmPebbleDuo')) || 
     {   'mode': 'Default' ,
            'high': 180,
            'low' : 80,
            'unit': 'mg/dL',
            'accountName': '',
            'password': '' ,
            'api' : '',
            'vibe' : 1,
            'raw' : false,
        };

    // if (id != defaultId) {
    //     options.id = id;
    // }
    //console.log("raw: " + options.raw);
    switch (options.mode) {
        case "Rogue":

            subscribeBy(options.api);
            rogue(options);
            break;

        case "Nightscout":

            subscribeBy(options.api);
            
            options.api = options.api.replace("/pebble?units=mmol","");
            options.api = options.api.replace("/pebble/","");
            options.api = options.api.replace("/pebble","");

            if(options.raw) {
                getNightscoutCalRecord(options);
            } else {
               nightscout(options); 
            }
            
            break;

        case "Share":

            subscribeBy(options.accountName);
            share(options);
            break;
            
         default:
         Pebble.sendAppMessage({
                    "vibe": 1, 	
                    "egv": "set",		
                    "trend": 0,	
                    "alert": 4,
                    "delta": "setup up required",
                    "id": defaultId,
                    "time_delta_int": -1,
                });
         break;
    }
}


var DIRECTIONS = {
    NONE: 0
    , DoubleUp: 1
    , SingleUp: 2
    , FortyFiveUp: 3
    , Flat: 4
    , FortyFiveDown: 5
    , SingleDown: 6
    , DoubleDown: 7
    , 'NOT COMPUTABLE': 8
    , 'RATE OUT OF RANGE': 9
};

function directionToTrend (direction) {
  var trend = 8;
  if (direction in DIRECTIONS) {
    trend = DIRECTIONS[direction];
  }
  return trend;
}

function noiseIntToNoiseString (noiseInt) {
   switch(noiseInt) {
       case 0:
        return "NCP";
       break;

       case 1:
        return "CLN";
       break;
       
       case 2:
        return "LGT";
       break;
       
       case 3:
        return "MED";
       break;
       
       case 4:
        return "HVY";
       break;        
   }
}

//ERRORS GETTING DATA
function sendAuthError() {
    Pebble.sendAppMessage({
                    "vibe": 1, 	
                    "egv": "log",		
                    "trend": 0,	
                    "alert": 4,
                    "delta": "login err",
                    "id": defaultId,
                    "time_delta_int": -1,
                });
}

function sendTimeOutError() {
     Pebble.sendAppMessage({
            "vibe": parseInt(options.vibe_temp,10),
            "egv": "tot",
            "trend": 0,
            "alert": 4,
            "delta": "tout-err",
            "id": defaultId,
            "time_delta_int": -1,
        });
}

function sendServerError() {
    Pebble.sendAppMessage({
            "vibe": parseInt(options.vibe_temp,10),
            "egv": "svr",
            "trend": 0,
            "alert": 4,
            "delta": "net-err",
            "id": defaultId,
            "time_delta_int": -1,
        });
}

function sendUnknownError(msg) {
    Pebble.sendAppMessage({
                "delta": msg,
                "egv": "exc",
                "trend": 0,
                "alert": 4,
                "vibe": 0,
                "id": defaultId,
                "time_delta_int": -1,
            }); 
}

function getNightscoutCalRecord(options){

    var url = options.api + "/api/v1/entries/cal.json?count=1";
    var http = new XMLHttpRequest();
    http.open("GET", url, true);
    http.onload = function (e) {
             
        if (http.status == 200) {
            var data = JSON.parse(http.responseText);
            //console.log("response: " + http.responseText);
             
            if (data.length == 0) {               
                options.raw = 0;
                nightscout(options);
            } else { 
                options.cal = {
                    'slope' : parseInt(data[0].slope, 10),
                    'intercept' : parseInt(data[0].intercept,10),
                    'scale' :  data[0].scale                  
                }
                nightscout(options);
            }

        } else {
           sendUnknownError("data err");
        }
    };
    
    http.onerror = function () {        
        sendServerError();
    };
    http.ontimeout = function () {
        sendTimeOutError();
    };

    try {
        http.send();
    }
    catch (e) {
        sendUnknownError("invalid url");
    }
    
    
}

//parse and use standard NS data
function nightscout(options) {

    if (options.unit == "mgdl" || options.unit == "mg/dL")
    {
        fix = 0;
        options.conversion = 1;
        options.unit = "mg/dL";
        
    } else {
        fix = 1;
        options.conversion = .0555;       
        options.unit = "mmol/L";
    }

    options.vibe = parseInt(options.vibe, 10);   
    var now = new Date();
    var http = new XMLHttpRequest();

    var url = options.api + "/api/v1/entries/sgv.json?count=9";
    http.open("GET", url, true);

    http.onload = function (e) {
             
        if (http.status == 200) {
            var data = JSON.parse(http.responseText);
            //console.log("response: " + http.responseText);
             
            if (data.length == 0) {               
                sendUnknownError("data err");
            } else { 
                
                 var body = 'Trend: ' + data[0].direction + '\nNoise: ' + noiseIntToNoiseString(data[0].noise)
                    + '\nUnfiltered: ' + data[0].unfiltered
                    + '\nFiltered: ' + data[0].filtered;
                
                //console.log("xdrip: " + data[0].device.indexOf("xDrip"));
                var deltaSuffix = "";
                var rawEgv = 0;
                if (options.raw && (data[0].device.indexOf("xDrip") == -1)) {
                    var currentCal = options.cal;
                    var ratio;
                    if (data[0].noise != 1) {
                        
                       //console.log(currentCal.scale)
                       //console.log(currentCal.intercept)
                       //console.log(currentCal.slope)
                       //console.log(data[0].sgv)
                      // console.log(data[0].unfiltered)
                      // console.log(data[0].filtered)
                       
                        if (data[0].filtered === 0 || data[0].sgv < 40) {
                            rawEgv = currentCal.scale * (data[0].unfiltered - currentCal.intercept) / currentCal.slope;
                        } else {
                            ratio = currentCal.scale * (data[0].filtered - currentCal.intercept) / currentCal.slope / data[0].sgv;
                            rawEgv = currentCal.scale * (data[0].unfiltered - currentCal.intercept) / currentCal.slope / ratio;
                        }
                        
                        deltaSuffix = " " + noiseIntToNoiseString(data[0].noise)
                        //console.log("raw egv " + rawEgv);
                    }

                    for (var i = 0; i < data.length; i++) {
                        if (data[i].noise != 1 && data[i].unfiltered) {                           
                            ratio = currentCal.scale * (data[i].unfiltered - currentCal.intercept) / currentCal.slope / data[i].sgv;
                            data[i].sgv = parseInt(currentCal.scale * (data[i].unfiltered - currentCal.intercept) / currentCal.slope / ratio);                           
                            //console.log("raw egv " + i + " " + data[i].sgv);
                        }                                             
                    }              

                }
            
                var timeAgo = now.getTime() - data[0].date;       
                var egv, delta, trend, convertedDelta;
                if (data.length == 1) {
                     delta = "can't calc";
                 } else {
                    var deltaZero = (data[0].sgv * options.conversion);
                    var deltaOne = (data[1].sgv * options.conversion);
                    convertedDelta = (deltaZero - deltaOne);
                }

                //Manage HIGH & LOW
                if (data[0].sgv == 39) {
                    egv = "low";
                    delta = "check bg";
                    trend = 0;
                } else if (data[0].sgv > 400) {
                    egv = "hgh";
                    delta = "check bg";
                    trend = 0;
                } else if (data[0].sgv < 39)    {
                    egv = "???";
                    delta = "check bg";
                    trend = 0;
                } else {
                    var convertedEgv = (data[0].sgv * options.conversion);
                    egv = (convertedEgv < 39 * options.conversion) ? parseFloat(Math.round(convertedEgv * 100) / 100).toFixed(1).toString() : convertedEgv.toFixed(fix).toString();
                    delta = (convertedEgv < 39 * options.conversion) ? parseFloat(Math.round(convertedDelta * 100) / 100).toFixed(1) : convertedDelta.toFixed(fix);
                    
                    var timeBetweenReads = data[0].date - data[1].date ;
                    var minutesBetweenReads = (timeBetweenReads / (1000 * 60)).toFixed(1);                              
                    delta = (delta/minutesBetweenReads * 5).toFixed(fix);
                                    
                    var deltaString = (delta > 0) ? "+" + delta.toString() : delta.toString();
					delta = deltaString + options.unit;
                    trend = (directionToTrend(data[0].direction) > 7) ? 0 : directionToTrend(data[0].direction);

                    options.egv = data[0].sgv;
                }
                var alert = calculateShareAlert(convertedEgv, data[0].date.toString(), options);
                var timeDeltaMinutes = Math.floor(timeAgo / 60000);             
                var d = new Date(data[0].date);
                var n = d.getMinutes();
                var pin_id_suffix = 5 * Math.round(n / 5);
                

                if (parseInt(data[0].sgv, 10) <= 39) {
                    title = "[SPARK] Special: " + data[0].sgv;
                }

                if (rawEgv > 0)
                    egv = (rawEgv*options.conversion).toFixed(fix).toString();
                  
                //console.log("post egv " + egv);
                    
                var title = "[SPARK] " + egv + " " + options.unit;

               
                var pin = {
                    "id": "pin-egv" + topic + pin_id_suffix,
                    "time": d.toISOString(),
                    "duration": 5,
                    "layout": {
                        "type": "genericPin",
                        "title": title,
                        "body": body,
                        "tinyIcon": "system://images/GLUCOSE_MONITOR",
                        "backgroundColor": "#FF5500"
                    },
                    "actions": [
                        {
                            "title": "Return to SPARK",
                            "type": "openWatchApp",
                            "launchCode": 1
                        }],

                };
                
                
                // //Manage OLD data
                if (timeDeltaMinutes >= 15) {
                    delta = "no data";
                    trend = 0;
                    egv = "old";
                    if (timeDeltaMinutes % 5 == 0)
                        alert = 4;
                }
                
                
                
                Pebble.sendAppMessage({
                    "delta": delta + deltaSuffix,
                    "egv": egv,	
                    "trend": trend,	
                    "alert": alert,	
                    "vibe": options.vibe_temp,
                    "id": data[0].date,
                    "time_delta_int": timeDeltaMinutes,
                    "bgs" : createNightscoutBgArray(data),
                    "bg_times" : createNightscoutBgTimeArray(data)
                });
                options.id = data[0].date;
                window.localStorage.setItem('cgmPebbleDuo', JSON.stringify(options));

                if (hasTimeline) {
                    insertUserPin(pin, topic, function (responseText) {
                        //console.log('Result: ' + responseText);
                    });
                }               
                
            }

        } else {
           sendUnknownError("data err");
        }
    };
    
    http.onerror = function () {        
        sendServerError();
    };
    http.ontimeout = function () {
        sendTimeOutError();
    };

    try {
        http.send();
    }
    catch (e) {
        sendUnknownError("invalid url");
    }
    
}

function createNightscoutBgArray(data) {
    var toReturn = "0,"; 
    var now = new Date();  
    for (var i = 0; i < data.length; i++) {       
        var wall = parseInt(data[i].date);
        var timeAgo = msToMinutes(now.getTime() - wall);
        if (timeAgo < 45 && data[i].type == 'sgv') {  
            toReturn = toReturn + data[i].sgv.toString() + ",";
        }
    }
    toReturn = toReturn.replace(/,\s*$/, "");  
    return toReturn;
}
    

function createNightscoutBgTimeArray(data) {
    var toReturn = ""
    var now = new Date();   
    for (var i = 0; i < data.length; i++) {  
        var wall = parseInt(data[i].date);
        var timeAgo = msToMinutes(now.getTime() - wall);
        //console.log("timeago: " + timeAgo);
        if (timeAgo < 45) {
            toReturn = toReturn + (45-timeAgo).toString() + ",";
        }
    } 
    toReturn = toReturn.replace(/,\s*$/, "");  
    return toReturn;  
}

//use D's share API------------------------------------------//
function share(options) {

    if (options.unit == "mgdl" || options.unit == "mg/dL")
    {
        fix = 0;
        options.conversion = 1;
        options.unit = "mg/dL";
        
    } else {
        fix = 1;
        options.conversion = .0555;       
        options.unit = "mmol/L";
    }
    options.vibe = parseInt(options.vibe, 10);
    var defaults = {
        "applicationId": "d89443d2-327c-4a6f-89e5-496bbb0317db"
        , "agent": "Dexcom Share/3.0.2.11 CFNetwork/711.2.23 Darwin/14.0.0"
        , login: 'https://share1.dexcom.com/ShareWebServices/Services/General/LoginPublisherAccountByName'
        , accept: 'application/json'
        , 'content-type': 'application/json'
        , LatestGlucose: "https://share1.dexcom.com/ShareWebServices/Services/Publisher/ReadPublisherLatestGlucoseValues"
    };

    authenticateShare(options, defaults);
}

function authenticateShare(options, defaults) {   
 
    var body = {
        "password": options.password
        , "applicationId": options.applicationId || defaults.applicationId
        , "accountName": options.accountName
    };

    var http = new XMLHttpRequest();
    var url = defaults.login;
    http.open("POST", url, true);
    http.setRequestHeader("User-Agent", defaults.agent);
    http.setRequestHeader("Content-type", defaults['content-type']);
    http.setRequestHeader('Accept', defaults.accept);
    
    var data;
    http.onload = function (e) {
        if (http.status == 200) {
            data = getShareGlucoseData(http.responseText.replace(/['"]+/g, ''), defaults, options);
        } else {
                sendAuthError();           
        }
    };
    
       http.ontimeout = function () {
        sendTimeOutError();
    };
    
    http.onerror = function () {
        sendServerError();
    };

    http.send(JSON.stringify(body));

}

function getShareGlucoseData(sessionId, defaults, options) {
    var now = new Date();
    var http = new XMLHttpRequest();
    var url = defaults.LatestGlucose + '?sessionID=' + sessionId + '&minutes=' + 1440 + '&maxCount=' + 8;
    http.open("POST", url, true);

    //Send the proper header information along with the request
    http.setRequestHeader("User-Agent", defaults.agent);
    http.setRequestHeader("Content-type", defaults['content-type']);
    http.setRequestHeader('Accept', defaults.accept);
    http.setRequestHeader('Content-Length', 0);

    http.onload = function (e) {
             
        if (http.status == 200) {
            var data = JSON.parse(http.responseText);
            //console.log("response: " + http.responseText)
            //handle arrays less than 2 in length
            if (data.length == 0) {                
                sendUnknownError("data err");
            } else { 
            
                //TODO: calculate loss
                var regex = /\((.*)\)/;
                var wall = parseInt(data[0].WT.match(regex)[1]);
                var timeAgo = now.getTime() - wall;       

                var egv, delta, trend, convertedDelta;

                if (data.length == 1) {
                    delta = "can't calc";
                } else {
                    var timeBetweenReads = parseInt(data[0].WT.match(regex)[1]) - parseInt(data[1].WT.match(regex)[1]);
                    var minutesBetweenReads = (timeBetweenReads / (1000 * 60)).toFixed(1);                                               
                    var deltaZero = data[0].Value * options.conversion;
                    var deltaOne = data[1].Value * options.conversion;
                    convertedDelta = (deltaZero - deltaOne);                   
                    delta = ((convertedDelta/minutesBetweenReads) * 5).toFixed(fix);
                    
                }

                //Manage HIGH & LOW
                if (data[0].Value < 40) {
                    egv = "low";
                    delta = "check bg";
                    trend = 0;
                } else if (data[0].Value > 400) {
                    egv = "hgh";
                    delta = "check bg";
                    trend = 0;
                } else {
                    var convertedEgv = (data[0].Value * options.conversion);
                    egv = (convertedEgv < 39 * options.conversion) ? parseFloat(Math.round(convertedEgv * 100) / 100).toFixed(1).toString() : convertedEgv.toFixed(fix).toString();
                    delta = (convertedEgv < 39 * options.conversion) ? parseFloat(Math.round(convertedDelta * 100) / 100).toFixed(1) : convertedDelta.toFixed(fix);
                    
                    
                    
                    
                    var deltaString = (delta > 0) ? "+" + delta.toString() : delta.toString();
					delta = deltaString + options.unit;
                    trend = (data[0].Trend > 7) ? 0 : data[0].Trend;

                    options.egv = data[0].Value;
                }
                var alert = calculateShareAlert(convertedEgv, wall, options);
                var timeDeltaMinutes = Math.floor(timeAgo / 60000);              
                var d = new Date(wall);
                var n = d.getMinutes();
                var pin_id_suffix = 5 * Math.round(n / 5);
                var title = "[SPARK] " + egv + " " + options.unit;
                var pin = {
                    "id": "pin-egv" + topic + pin_id_suffix,
                    "time": d.toISOString(),
                    "duration": 5,
                    "layout": {
                        "type": "genericPin",
                        "title": title,
                        "body": "Dexcom Share",
                        "tinyIcon": "system://images/GLUCOSE_MONITOR",
                        "backgroundColor": "#FF5500"
                    },
                    "actions": [
                        {
                            "title": "Launch App",
                            "type": "openWatchApp",
                            "launchCode": 1
                        }],

                };
                
                //Manage OLD data
                if (timeDeltaMinutes >= 15) {
                    delta = "no data";
                    trend = 0;
                    egv = "old";
                    if (timeDeltaMinutes % 5 == 0)
                        alert = 4;
                }
                Pebble.sendAppMessage({
                    "delta": delta,
                    "egv": egv,	
                    "trend": trend,	
                    "alert": alert,	
                    "vibe": options.vibe_temp,
                    "id": wall,
                    "time_delta_int": timeDeltaMinutes,
                    "bgs" : createShareBgArray(data),
                    "bg_times" : createShareBgTimeArray(data)
                });
                options.id = wall;
                window.localStorage.setItem('cgmPebbleDuo', JSON.stringify(options));
                
                if (hasTimeline) {
                    insertUserPin(pin, topic, function (responseText) {
                        //console.log('Result: ' + responseText);
                    });
                }  
            }

        } else {
            sendUnknownError("data err");
        }
    };
    
    http.onerror = function () { 
        sendServerError();
    };
   http.ontimeout = function () {
        sendTimeOutError();
    };

    http.send();
}

function createShareBgArray(data) {
    var toReturn = "0,";
    var regex = /\((.*)\)/;
    var now = new Date();
    
    for (var i = 0; i < data.length; i++) {
        var wall = parseInt(data[i].WT.match(regex)[1]);
        var timeAgo = msToMinutes(now.getTime() - wall);
        if (timeAgo < 45) {  
            toReturn = toReturn + data[i].Value.toString() + ",";
        }
    }
    toReturn = toReturn.replace(/,\s*$/, "");  
    return toReturn;
}
    

function createShareBgTimeArray(data) {
    var toReturn = "";
    var regex = /\((.*)\)/;
    var now = new Date();
    
    for (var i = 0; i < data.length; i++) {  
        var wall = parseInt(data[i].WT.match(regex)[1]);
        var timeAgo = msToMinutes(now.getTime() - wall);
        //console.log("timeago: " + timeAgo);
        if (timeAgo < 45) {
            toReturn = toReturn + (45-timeAgo).toString() + ",";
        }
    } 
    toReturn = toReturn.replace(/,\s*$/, "");  
    return toReturn;  
}

function msToMinutes(millisec) {
    return (millisec / (1000 * 60)).toFixed(1);
}

function calculateShareAlert(egv, currentId, options) {
    //console.log("comparing: " + currentId + " to " + options.id);
    if (parseInt(options.id, 10) == parseInt(currentId, 10)) {
        options.vibe_temp = 0;
    } else {
        options.vibe_temp = options.vibe + 1;
    }

    if (egv <= options.low){
        return 2;
    }

    if (egv >= options.high) {
        return 1;
    }
        
    return 0;
}

//using something different? code it up here-------ROGUE-----------------------------//:
function rogue(options) {
    var response;
    var req = new XMLHttpRequest();
    //console.log("api: " + options.api);
    req.open('GET', options.api, true);

    req.onload = function (e) {
        //console.log(req.readyState);
        if (req.readyState == 4) {
            //console.log(req.status);
            if (req.status == 200) {
                //console.log("text: " + req.responseText);
                response = JSON.parse(req.responseText);
                
                options.wt = response[0].datetime;
                options.egv = response[0].sgv;
                var alert = calculateAlert(response[0].avgloss, Math.floor(response[0].timesinceread), Math.round(response[0].timesinceupload), response[0].noise, options.id, response[0].id.toString(), options);
                var egv = response[0].sgv;
                if (response[0].noise != "Clean")
                    egv = response[0].calculatedBg.toString();

                var delta = Math.round(response[0].timesinceread) + " min. ago";
                if (Math.round(response[0].timesinceread) < 1)
                    delta = "now";
                    
                if  (response[0].trend == 4)
                     response[0].trend = 0;
                else if  (response[0].trend < 4)
                     response[0].trend = response[0].trend + 1;     
                     
                var trend = (response[0].trend > 7) ? 0 : response[0].trend;       

                Pebble.sendAppMessage({
                    "delta": response[0].bgdelta.toString() + "mg/dL", 	//str
                    "egv": egv,		//str	
                    "trend": trend,	//int
                    "alert": alert,	//int
                    "vibe": parseInt(options.vibe_temp,10),
                    "id": response[0].id,
                    "time_delta_int": Math.floor(response[0].timesinceread),
                    "bgs" : createBgArray(response),
                    "bg_times" : createBgTimeArray(response)
                    
                });
                options.id = response[0].id;
                window.localStorage.setItem('cgmPebbleDuo', JSON.stringify(options));
            } else {
                sendUnknownError("data err");
            }
        } else {
            //console.log("second if");
        }
    };
    
    req.onerror = function () {
        sendServerError();
    };
   req.ontimeout = function () {
        sendTimeOutError();
    };
    req.send(null);
}

function createBgArray(data) {
    var toReturn = "1,";
    for (var i = 0; i < data.length ; i++) {
         if (data[i].tsince <= 45 && i < data.length-1) {
             toReturn = toReturn + data[i].sgv + ",";
         } 
    }
    toReturn = toReturn.replace(/,\s*$/, "");  
    return toReturn;
}
    
function createBgTimeArray(data) {
    var toReturn = []
     for (var i = 0; i < data.length ; i++) {
         if (data[i].tsince <= 45 && i < data.length-1) {
             toReturn = toReturn + data[i].tnow + ",";
         } 
    } 
    toReturn = toReturn.replace(/,\s*$/, "");  
    return toReturn;  
}

function calculateAlert(loss, read, upload, noise, id_p, id_w, options) {
    //console.log("comparing: " + id_p + " to " + id_w);
    //console.log("options.vibe: " + options.vibe);
 
    if (read >= 15) {
        var temp_alert = 0;
        if (read % 5 == 0) {
            temp_alert = 1;
        }
        options.vibe_temp = temp_alert;
        return 4;
    }

    if (id_p == id_w) {
        options.vibe_temp = 0;
    } else {
        options.vibe_temp = options.vibe + 1;
    }
				
    if (loss * 100 > 4.5)
        return 2;

    if (loss * 100 > 2)
        return 1;

    return 0;
}

Pebble.addEventListener("showConfiguration", function () {
    Pebble.openURL('http://cgmwatch.azurewebsites.net/config.2.html');
});

Pebble.addEventListener("webviewclosed", function (e) {
    var options = JSON.parse(decodeURIComponent(e.response));
    window.localStorage.setItem('cgmPebbleDuo', JSON.stringify(options));
    fetchCgmData(defaultId);
});

Pebble.addEventListener("ready",
    function (e) {
        //console.log("ready");      
        var options = JSON.parse(window.localStorage.getItem('cgmPebbleDuo')) || 
        {    'mode': 'Share' ,
            'high': 180,
            'low' : 80,
            'unit': 'mg/dL',
            'accountName': '',
            'password': '' ,
            'api' : '',
            'vibe' : 1,
            'id' : defaultId,
        };     
        fetchCgmData(options.id);
    });

Pebble.addEventListener("appmessage",
    function (e) {
        //console.log("appmessage");
        fetchCgmData(e.payload.id);
    });
    
// The timeline public URL root
var API_URL_ROOT = 'https://timeline-api.getpebble.com/';

function timelineRequest(pin, topic, type, callback) {
    
    // User or shared?
    //var url = API_URL_ROOT + 'v1/user/pins/' + pin.id;
    var url = API_URL_ROOT + 'v1/shared/pins/' + pin.id;
    // Create XHR
    var xhr = new XMLHttpRequest();
    xhr.onload = function() {
        //console.log('timeline: response received: ' + this.responseText);
        callback(this.responseText);
    };
    
    
    xhr.open(type, url);

    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('X-API-Key', '');
    xhr.setRequestHeader('X-Pin-Topics', topic);

    // Send
    xhr.send(JSON.stringify(pin));
    //console.log('timeline: request sent.');
   
    var xhrSb = new XMLHttpRequest();
    xhrSb.onload = function() {
        //console.log('timeline: response received: ' + this.responseText);
        callback(this.responseText);
    };
    xhrSb.open(type, url);
   
    xhrSb.setRequestHeader('Content-Type', 'application/json');
    xhrSb.setRequestHeader('X-API-Key', '');
    xhrSb.setRequestHeader('X-Pin-Topics', topic); 
    
    xhrSb.send(JSON.stringify(pin));
    //console.log('timeline: SB request sent.');
   
}

function insertUserPin(pin, topic, callback) {
    if (topic != "not_set")
        timelineRequest(pin, topic, 'PUT', callback);
}

function subscribeBy(base) {
    try {        
        topic = hashCode(base).toString();
        Pebble.getTimelineToken(
            function (token) {
                //console.log('My timeline token is: ' + token);
            },
            function (error) {
                //console.log('Error getting timeline token: ' + error);
                hasTimeline = 0;
            }
            );
        Pebble.timelineSubscribe(topic,
            function () {
                //console.log('Subscribed to: ' + topic);
            },
            function (errorString) {
                //console.log('Error subscribing to topic: ' + errorString);
                hasTimeline = 0;
            }
            );
    } catch (err) {
        //console.log('Error: ' + err.message);
        hasTimeline = 0;
    }
    
    if (hasTimeline)
        cleanupSubscriptions();

}

function cleanupSubscriptions() {
    Pebble.timelineSubscriptions(
        function (topics) {
            //console.log('Subscribed to ' + topics.join(','));
            //console.log("subs: " + topics);
            for (var i = 0; i < topics.length; i++) {
                //console.log("topic: " + topic)
                //console.log("topics[i]: " + topics[i])
                if (topic != topics[i]) {
                    Pebble.timelineUnsubscribe(topics[i],
                        function () {
                            //console.log('Unsubscribed from: ' + topics[i]);
                        },
                        function (errorString) {
                            //console.log('Error unsubscribing from topic: ' + errorString);
                        }
                        );
                }
            }

        },
        function (errorString) {
            //console.log('Error getting subscriptions: ' + errorString);
            return ",";
        }
        );
}

function hashCode(base) {
    var hash = 0, i, chr, len;
    if (base.length == 0) return hash;
    for (i = 0, len = base.length; i < len; i++) {
        chr = base.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0; // Convert to 32bit integer
    }
    return hash;
};

/***************************** end timeline lib *******************************/

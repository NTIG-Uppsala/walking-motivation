'use strict';

/* -------------------------------------------------------------------------- */
/*                                 Dependencies                               */
/* -------------------------------------------------------------------------- */

const express = require('express');
const { check, validationResult } = require('express-validator');
const mariadb = require('mariadb');
const bodyParser = require('body-parser'); // Middleware
const app = express();
const PORT = process.env.PORT || 8080;
const fs = require('fs');


/* -------------------------------------------------------------------------- */
/*                               MariaDB config                               */
/* -------------------------------------------------------------------------- */


const pool = mariadb.createPool({
    host: readConfig('DB_HOST'),
	user: readConfig('DB_USERNAME'),
	password: readConfig('DB_PASS'),
	database: readConfig('DB_DATABASE'),
	connectionLimit : 20
});


/* -------------------------------------------------------------------------- */
/*                                 Middleware                                 */
/* -------------------------------------------------------------------------- */


//Parse JSON
app.use(express.json());

app.use(bodyParser.urlencoded({ extended: false }));


/* -------------------------------------------------------------------------- */
/*                              Helper variables                              */
/* -------------------------------------------------------------------------- */


/* ------------------------- Check if mail is a mail ------------------------ */
var validateMail = [ //Documentation uses var so I'll use var
    check('mail', 'Måste vara en mail').isEmail().trim().escape().normalizeEmail()
]

/* -------------------------------------------------------------------------- */
/*                                  API routes                                 */
/* -------------------------------------------------------------------------- */


/* ------------------------------ GET requests ------------------------------ */

/**
 * Get task and task Id from task table
 * @return  A random task from the database with all the task info
 */
app.get('/task', (req, res) => {
    getRandomTaskFromDatabase().then(result => {
        res.send(result);
    });
});

/**
 * Get points for specific mail
 * @param {JSON} req    Mail
 * @return              Number of points
 */
app.get('/points', validateMail, (req, res) => {
    console.log(req.query.mail);
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    getUserPointsFromDatabase(req.query.mail).then(result => {
        res.send(result);
    });
});


/**
 * Get the current task they are on if there is a current task, via query
 * @param {JSON} req    Mail
 * @return              The response fom the api
 */
app.get('/currTask',validateMail, async function(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    const mail = req.query.mail;
    let availableTask = await latestUserTaskStatus(mail);
    if (availableTask == 2 || availableTask == 3) return res.send('Inget aktivt uppdrag');
    latestUserTaskStatus(mail, 'Get active task').then (result => {
        res.send(result);
    });
});


/* ------------------------------ POST requests ----------------------------- */

/**
 * Post request, check if user is in db, If it's not the it will be added.
 * @param {JSON} req    Mail
 * @return              The response fom the api
 */
app.post('/user', validateMail, (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    const mail = req.body.mail;
    checkUserInDatabase(mail).then(result => {
        res.send(result);
    });
});


/**
 * Accept a task
 * @param {JSON} req    Mail, taskId
 * @return              The response fom the api
 */
app.post('/accTask', validateMail, async function(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({errors: errors.array});
    const taskId = req.body.task_id; 
    const mail = req.body.mail;
    const userId = await getUserIdWithMail(mail);
    if (userId == -1) return res.send('Ogiltig mail');
    let availableTask = await latestUserTaskStatus(mail);
    if (availableTask == 1) return res.send('Du har redan ett uppdrag');
    setTaskStatus(userId, taskId).then(result => {
        res.send("Ditt uppdarg är accepterat");
    })
})

/* ------------------------------- PUT request ------------------------------ */
/**
 * Put request, chance latest accepted task status to done or cancel
 * @param {JSON} req    Mail, status
 * @return              The response fom the api
 */
app.put('/changeTask', validateMail, async function(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    const status = req.body.status;
    const mail = req.body.mail;
    if (status != '2' && status != '3') return res.send('Ogiltlig siffra');
    let availableTask = await latestUserTaskStatus(mail);
    if (availableTask == 2 || availableTask == 3) return res.send('Inget aktivt uppdrag');
    let pointsToBeAwarded = await latestUserTaskStatus(mail, 'Get active task') //For the points
    changeTaskStatus(mail, status).then(result => {
        if (result.affectedRows == 0)  return res.send('Denna användare finns inte');
        if (status == '3') return res.send('Det är okej, du klarar nästa uppdrag!')
        addPointsToUser(mail, pointsToBeAwarded.task_points);
        return res.send('Grattis, du klarade uppdraget!');
    });
});


/* ------------------- DELETE request for testing purpose ------------------- */
/**
 * API request WILL delete a user from the table
 * @param {JSON} req    Mail, password
 * @return              The response fom the api
 */
app.delete('/user', validateMail, function(req, res) {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });
    const mail = req.body.mail;
    const pw = req.body.pw;
    if (pw != readConfig('API_KEY')) return res.send('Felaktigt lösenord');
    deleteUserFromDatabase(mail).then(result => {
        if (result.affectedRows == 0) return res.send('Denna användare finns inte');
        return res.send('Användare Borttagen');
    });
});


/* -------------------------------------------------------------------------- */
/*                          Functions used in the API                         */
/* -------------------------------------------------------------------------- */


/* --------- Random task and corresponding points from the task table-------- */
/**
 * From the database get all the task info at random
 * @returns Task info
 */
async function getRandomTaskFromDatabase() {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('SELECT task_query, task_id, task_points FROM traylsdb ORDER BY RAND() LIMIT 1'); //Randomly select a task from task table
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        result = result[0];
        return result; //Returns the task info without meta
    }
}

/* ----------------- Add a user to database with mail as id ----------------- */
/**
 * Add a mail to the database, SQL will give it all other info
 * @param {String} mail The mail that will be inserted into a row
 * @returns The whole SQL response (not using response)
 */
async function addUserToDatabase(mail) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('INSERT INTO users (user_mail) VALUES (?)', mail); //Add user to database
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        return result; //The whole sql response
    }
}

/* ------------- Check if user is in database and add if its not ------------ */
/**
 * Check if there is a row with the specified mail in the database
 * @param {String} mail The mail
 * @returns {String} If mail in database return 'Välkommen tillbaka' else add Mail to database and Return 'Ny användare'
 */
async function checkUserInDatabase(mail) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('SELECT user_mail FROM users WHERE user_mail = ?', mail); //Check if user is in database
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        result = result[0];
        if (result === undefined) {
            addUserToDatabase(mail);
            return 'Ny användare';
        }
        return 'Välkommen tillbaka';
    }
}

/* --------------------------- Get a mails user id -------------------------- */
/**
 * With a mail get the id connected to that mail
 * @param {String} mail The mail which id you are after
 * @returns {int}       The user id
 */
async function getUserIdWithMail(mail) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('SELECT user_id FROM users WHERE user_mail = ?', mail); //Get the user id from a mail adress
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        result = result[0];
        if (result === undefined) {
            return -1; 
        }
        return result['user_id']; //Only returns the user id from the sql database
    }
}

/* ------------- Add points to the user with the specified mail ------------- */
/**
 * With a mail and points add points to the user, should be used after a task is done
 * @param {String} mail 
 * @param {int} pointsToBeAwarded
 * @returns {int} The amount of points the user has
 */

async function addPointsToUser(mail, pointsToBeAwarded) {
    let conn;
    let result
    try {
        conn = await pool.getConnection();
        result = await conn.query('UPDATE users SET user_points = user_points + ? WHERE user_mail = ?', [pointsToBeAwarded, mail]); //Add points to the user
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        return getUserPointsFromDatabase(mail); //Returns the amount of points the user has
    }
}

/* ---------------------- Get user points from database --------------------- */
/**
 * With a mail, get the number of points that the mail has
 * @param {String} mail     The mail containing the points you want to get
 * @returns                 The number of points
 */
async function getUserPointsFromDatabase(mail) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('SELECT user_points FROM users WHERE user_mail = ?', mail); //Get user points from database
        result = result[0];
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        return result; //Returns sql response without meta
    }
}


/* -------- Confirm task and add the task_id, user_id and task_state to the db -------- */
/**
 * Adds a task to the database with a default value of 1 (1 doing)
 * @param {int} userId      The id a user has
 * @param {int} taskId      The task that will be inserted into the "active task table"
 * @returns                 The whole SQL response
 */
async function setTaskStatus(userId, taskId) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('INSERT INTO task_state (user_id, task_id, task_status, task_history) VALUES (?, ?, ?, ?)', [userId, taskId, 1, null]); //Add task_state to database taskState can be 1,2 or 3 //1 = in progress, 2 = done, 3 = canceled
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        return result; //Returns the whole sql response 
    }
}

/* ----------- Change the latest taskState a mail has to 2 or 3 ----------- */
/**
 *  Changes the state of the latest task to new desired state
 * @param {String} mail     The mail to which the status will be changed 
 * @param {int} taskState   To what state the task will be set to (2 done, 3 canceled)
 * @returns                 The number of affected rows (0 no task was found)
 */
async function changeTaskStatus(mail, taskState) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('UPDATE task_state SET task_status = ? WHERE user_id = (SELECT user_id FROM users WHERE user_mail = ?) ORDER BY task_history DESC LIMIT 1', [taskState, mail]); //Change the latest taskState a mail has to 2 or 3
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        return result; //Returns the nr of affected rows
    }
}

/* -------------------- Delete user from database by mail ------------------- */
/**
 * Removes a user form the database (only used for testing so far)
 * @param {String} mail     The mail you would like to remove from the database 
 * @returns                 The number of affected rows if 0 no user with that mail was found
 */
async function deleteUserFromDatabase(mail) {
    let conn;
    let result;
    try {
        conn = await pool.getConnection();
        result = await conn.query('DELETE FROM users WHERE user_mail = ?', mail); //Delete user from database
    } catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        return result; //Returns the number of affected rows
    }
}

/* --------------------------- Return current task -------------------------- */
/**
 * From database return the task a user has active
 * @param {int} latestTask  The latest task you have 
 * @returns                 What task you are on with all the info about that task
 */
async function getCurrentTask(latestTask){ //can't be called from user
    let conn;
    let result;
    try {
        if (latestTask.task_status != 1) return 'Ingen aktiv task';
        conn = await pool.getConnection();
        result = await conn.query('SELECT task_query, task_points FROM traylsdb WHERE task_id = ?', latestTask.task_id); //Get the task row with all info about a task
    } catch (err) {
        console.error(err);
    } finally {
        return result[0]; //Returns database response without meta
    }
}

/* --------------------- Latest task a user has accepted -------------------- */
/**
 * From database get the latest task the user has active
 * @param {String} mail     What mail to which task status you want to access
 * @param {String} purpose  Specify what output you'd like
 * @returns {int}           The status of the latest task / status of the current task
 */
async function latestUserTaskStatus(mail, purpose) {
    let conn;
    let result;
    try{
        conn = await pool.getConnection();
        result = await conn.query('SELECT * FROM task_state WHERE user_id = (SELECT user_id FROM users WHERE user_mail = ?) ORDER BY task_history DESC LIMIT 1', mail); //Get the row with task history and such
        result = result[0];
    }catch (err) {
        console.error(err);
    } finally {
        if (conn) conn.end();
        if (result === undefined) return 'First time user'; //This msg is not in use right now
        if (purpose == 'Get active task') return getCurrentTask(result);
        return result.task_status; //Return the status of the task
    }
}


/* ------------------------- Read file to get config ------------------------ */
/**
 * Read and get the config values
 * @param {String} key  The object you want to obtain from you config file 
 * @returns {String}    The value of the of the key in the config file
 */
function readConfig(key) {
    const json = fs.readFileSync('../../trayls.json');
    const parsedJson = JSON.parse(json);
    return parsedJson[key];
}

/* -------------------------------------------------------------------------- */
/*                                 Middleware                                 */
/* -------------------------------------------------------------------------- */

//Middleware takes care of 404
//If higher up in code, it will be called first for some reason, and will not go through with any API calls
app.use(function(req, res) {
    res.status(404).send({url: '404 Error'});
});


/* -------------------------------------------------------------------------- */
/*                                 API startup                                */
/* -------------------------------------------------------------------------- */


//Starts the API for it to listen
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
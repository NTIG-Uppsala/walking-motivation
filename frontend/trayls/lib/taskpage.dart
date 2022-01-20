import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

class TaskPage extends StatefulWidget {
  const TaskPage({Key? key}) : super(key: key);

  @override
  _TaskPageState createState() => _TaskPageState();
}

class _TaskPageState extends State<TaskPage> {
  getTask() async {
    var response = await http.get(Uri.http('netlabua.se', '/task'));
    var jsonData = jsonDecode(response.body);

    List<String> task = [];
    task.add(jsonData['task_query']); //Very ugly, but it works
    task.add(jsonData['task_id'].toString()); //Very ugly, but it works
    task.add(jsonData['task_points'].toString()); //Very ugly, but it works
    return task;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        //We set the Page title
        toolbarHeight: 100,
        centerTitle: true,
        foregroundColor: Colors.black,
        title: const Text("Uppdraget",
            style: TextStyle(fontSize: 50, fontFamily: "")),
      ),
      body: FutureBuilder(
        future: getTask(),
        builder: (BuildContext context, AsyncSnapshot snapshot) {
          if (snapshot.data == null) {
            return const Center(
              child: Text('Loading...'),
            );
          } else {
            return Column(
              children: <Widget>[
                Text(
                  snapshot.data[0], //Very ugly, but it works
                  style: const TextStyle(fontSize: 20),
                ),
                Text(
                  'Poäng: ${snapshot.data[2]}', //Very ugly, but it works
                  style: const TextStyle(fontSize: 20),
                ),
              ],
            );
          }
        },
      ),
    );
  }
}

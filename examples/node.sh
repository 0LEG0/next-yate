#!/bin/sh

# require arg .js file
if [ -n "$1" ]
then
# customize nodejs enviroment
# SCRIPTS=/path_to/share/scripts
SCRIPTS=./share/scripts
export NODE_PATH=$SCRIPTS
NODE=`which node`
# run script
$NODE $SCRIPTS/$1
fi
